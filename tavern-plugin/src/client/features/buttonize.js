        // Fork: Buttonize. Rules (Tavern settings `buttonizeRules`, edited in the "Buttonize" tab) name a heading;
        // in assistant replies the list right after a matching heading is rendered as buttons. Pressing one sends
        // the item as the user's message, through the chat input like the send button. Only the latest reply's
        // buttons are live, and not while a reply is being generated. The rendered DOM is DSH's: list items get
        // attributes (re-applied on every chat mutation), nothing is replaced.
        const buttonizeRules = (() => {
            let rules = null, revision = 0;
            const listeners = new Set();
            const changed = "dsh-tavern:buttonize-changed";
            function publish(next) { rules = next; listeners.forEach(listener => listener()); }
            async function refresh() {
                const request = ++revision;
                try { const result = await rpc("getTavernSettings"); if (request === revision) publish(result.settings?.buttonizeRules || []); } catch (_) {}
            }
            let started = false;
            function start() {
                if (started) return; started = true;
                refresh();
                window.addEventListener("focus", refresh);
                window.addEventListener("storage", event => { if (event.key === changed) refresh(); });
            }
            return {
                subscribe(listener) { start(); listeners.add(listener); return () => listeners.delete(listener); },
                snapshot: () => rules,
                async update(patch) {
                    ++revision;
                    const result = await rpc("updateTavernSettings", { patch });
                    ++revision; publish(result.settings?.buttonizeRules || []);
                    try { window.localStorage.setItem(changed, String(Date.now())); } catch (_) {}
                }
            };
        })();

        function buttonizeHeadingMatcher(heading) {
            const text = String(heading || "").trim();
            if (text.length > 2 && text.startsWith("/") && text.endsWith("/")) {
                try { const pattern = new RegExp(text.slice(1, -1)); return value => pattern.test(value); } catch (_) { return () => false; }
            }
            return value => value.includes(text);
        }

        // Mark the lists of `root` that follow a heading matching an enabled rule. Returns the marked items.
        function applyButtonize(root, rules, busy) {
            const matchers = (rules || []).filter(rule => rule.enabled).map(rule => buttonizeHeadingMatcher(rule.heading));
            const marked = new Set();
            if (matchers.length) {
                const steps = Array.from(root.querySelectorAll('[data-chat-flow-kind="assistant-step"]'));
                const latest = steps.reduce((max, step) => Math.max(max, Number(step.getAttribute("data-chat-turn")) || 0), 0);
                for (const step of steps) {
                    const live = (Number(step.getAttribute("data-chat-turn")) || 0) === latest;
                    for (const heading of step.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
                        const title = (heading.textContent || "").trim();
                        if (!title || !matchers.some(match => match(title))) continue;
                        let list = null;
                        for (let next = heading.nextElementSibling; next && !/^H[1-6]$/.test(next.tagName); next = next.nextElementSibling) {
                            if (next.tagName === "OL" || next.tagName === "UL") { list = next; break; }
                        }
                        if (!list) continue;
                        list.setAttribute("data-dsh-buttonize-list", "");
                        for (const item of list.children) {
                            if (item.tagName !== "LI" || !(item.textContent || "").trim()) continue;
                            const state = live ? "live" : "old";
                            if (item.getAttribute("data-dsh-buttonize") !== state) item.setAttribute("data-dsh-buttonize", state);
                            if (item.getAttribute("role") !== "button") item.setAttribute("role", "button");
                            const disabled = String(!live || busy);
                            if (item.getAttribute("aria-disabled") !== disabled) item.setAttribute("aria-disabled", disabled);
                            const tabIndex = live && !busy ? "0" : "-1";
                            if (item.getAttribute("tabindex") !== tabIndex) item.setAttribute("tabindex", tabIndex);
                            marked.add(item);
                        }
                    }
                }
            }
            for (const item of root.querySelectorAll("[data-dsh-buttonize]")) {
                if (marked.has(item)) continue;
                for (const name of ["data-dsh-buttonize", "role", "aria-disabled", "tabindex"]) item.removeAttribute(name);
            }
            for (const list of root.querySelectorAll("[data-dsh-buttonize-list]")) {
                if (!list.querySelector("[data-dsh-buttonize]")) list.removeAttribute("data-dsh-buttonize-list");
            }
            return marked;
        }

        function buttonizeItemText(item) {
            return (item.innerText || item.textContent || "").replace(/\s+\n/g, "\n").trim();
        }

        // Rendered in the input dock of every play chat: keeps the chat's lists buttonized and sends presses.
        function TavernButtonizeDock(props) {
            const marker = React.useRef(null);
            const rules = React.useSyncExternalStore(buttonizeRules.subscribe, buttonizeRules.snapshot, buttonizeRules.snapshot);
            const running = props.useSession(snapshot => snapshot.running === true);
            const latestMessageId = props.useChat(latestTavernAssistantMessageId);
            const sendingRef = React.useRef(false);
            React.useEffect(function () {
                const root = marker.current && marker.current.closest("[data-conversation-scroll]");
                if (!root || !rules || !rules.some(rule => rule.enabled)) {
                    if (root) applyButtonize(root, [], running);
                    return;
                }
                let frame = null, disposed = false;
                const apply = () => { if (!disposed) applyButtonize(root, rules, running || sendingRef.current); };
                apply();
                const observer = new MutationObserver(function () {
                    if (frame === null) frame = window.requestAnimationFrame(function () { frame = null; apply(); });
                });
                observer.observe(root, { childList: true, subtree: true, characterData: true });
                async function press(item) {
                    if (!item || item.getAttribute("data-dsh-buttonize") !== "live" || item.getAttribute("aria-disabled") === "true" || sendingRef.current) return;
                    const text = buttonizeItemText(item);
                    if (!text) return;
                    sendingRef.current = true; apply();
                    try { await props.sendText(props.sessionId, text); }
                    catch (error) { tavernErrorHub.report("Buttonize", error); }
                    finally { sendingRef.current = false; apply(); }
                }
                function onClick(event) {
                    const item = event.target instanceof Element ? event.target.closest("[data-dsh-buttonize]") : null;
                    if (!item || !root.contains(item)) return;
                    if (event.target.closest("a, button, input, select, textarea")) return;
                    event.preventDefault();
                    press(item);
                }
                function onKey(event) {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    const item = event.target instanceof Element ? event.target.closest("[data-dsh-buttonize]") : null;
                    if (!item || event.target !== item) return;
                    event.preventDefault();
                    press(item);
                }
                root.addEventListener("click", onClick);
                root.addEventListener("keydown", onKey);
                return function () {
                    disposed = true;
                    observer.disconnect();
                    if (frame !== null) window.cancelAnimationFrame(frame);
                    root.removeEventListener("click", onClick);
                    root.removeEventListener("keydown", onKey);
                    applyButtonize(root, [], false);
                };
            }, [rules, running, latestMessageId, props.sessionId]);
            return React.createElement("span", { ref: marker, hidden: true, "data-dsh-buttonize-marker": "" });
        }

        // The "Buttonize" tab: the rules (global, every chat and device).
        function TavernButtonizeTab() {
            const h = React.createElement;
            const rules = React.useSyncExternalStore(buttonizeRules.subscribe, buttonizeRules.snapshot, buttonizeRules.snapshot);
            const askConfirm = useTavernConfirm();
            const [editing, setEditing] = React.useState(null);
            const [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
            async function update(patch, question) {
                if (question && !await askConfirm(question)) return false;
                setBusy(true); setError("");
                try { await buttonizeRules.update(patch); return true; }
                catch (err) { setError(String(err && err.message || err)); return false; }
                finally { setBusy(false); }
            }
            async function save(event) {
                event.preventDefault();
                if (await update({ saveButtonizeRule: { ...(editing.id ? { id: editing.id } : {}), name: editing.name, heading: editing.heading } })) setEditing(null);
            }
            const field = { display: "grid", gap: "6px", fontSize: "12px", minWidth: 0 };
            const link = { border: 0, padding: 0, background: "none", color: "var(--dsh-tavern-accent, #c96a3b)", cursor: "pointer", font: "inherit", fontSize: "12px" };
            const editor = editing ? h("form", { onSubmit: save, style: { display: "grid", gap: "10px", padding: "12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" } },
                h("label", { style: field }, "Heading",
                    h("input", { className: "dsh-tavern-settings-select", value: editing.heading, autoFocus: true, required: true, maxLength: 200, placeholder: "行動選擇", disabled: busy, style: { maxWidth: "none" }, onChange: event => setEditing({ ...editing, heading: event.target.value }) })),
                h("p", { className: "dsh-tavern-settings-desc", style: { margin: 0 } }, "Text contained in a heading of the reply (any level, e.g. \"### 行動選擇\"), or a /regex/. The list right after that heading becomes buttons."),
                h("label", { style: field }, "Name (optional)",
                    h("input", { className: "dsh-tavern-settings-select", value: editing.name, maxLength: 80, disabled: busy, style: { maxWidth: "none" }, onChange: event => setEditing({ ...editing, name: event.target.value }) })),
                h("div", { style: { display: "flex", gap: "8px" } },
                    h("button", { type: "submit", className: "dsh-tavern-btn", disabled: busy || !editing.heading.trim() }, editing.id ? "Save" : "Add rule"),
                    h("button", { type: "button", className: "dsh-tavern-btn quiet", disabled: busy, onClick: () => setEditing(null) }, "Cancel"))) : null;
            return h("aside", { className: "dsh-tavern-status dsh-tavern-buttonize-tab" },
                h("div", { className: "dsh-tavern-status-body", style: { display: "grid", gap: "12px" } },
                    h("section", { className: "dsh-tavern-status-section", style: { display: "grid", gap: "10px" } },
                        h("div", { className: "dsh-tavern-status-label" }, "Buttonize"),
                        h("p", { className: "dsh-tavern-settings-desc", style: { margin: 0 } }, "Turn a list in the replies into buttons: pressing one sends that item as your message. Only the latest reply's buttons work. Rules apply to every chat."),
                        rules === null ? h("div", { className: "dsh-tavern-status-empty" }, "Loading…")
                            : rules.length === 0 && !editing ? h("div", { className: "dsh-tavern-status-empty" }, "No rules yet.") : null,
                        h("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" } }, (rules || []).map(rule => h("li", { key: rule.id, style: { display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "10px", alignItems: "start", padding: "10px 12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px", opacity: rule.enabled ? 1 : .6 } },
                            h("input", { type: "checkbox", role: "switch", "aria-label": "Enable " + rule.name, checked: rule.enabled, disabled: busy, style: { marginTop: "3px" }, onChange: event => update({ saveButtonizeRule: { id: rule.id, heading: rule.heading, enabled: event.target.checked } }) }),
                            h("div", { style: { display: "grid", gap: "3px", minWidth: 0 } },
                                h("div", { style: { fontWeight: 600, fontSize: "13px", overflowWrap: "anywhere" } }, rule.name),
                                rule.name !== rule.heading ? h("code", { style: { fontSize: "12px", opacity: .75, overflowWrap: "anywhere" } }, rule.heading) : null,
                                h("div", { style: { display: "flex", gap: "14px" } },
                                    h("button", { type: "button", style: link, disabled: busy || !!editing, onClick: () => setEditing({ id: rule.id, name: rule.name === rule.heading ? "" : rule.name, heading: rule.heading }) }, "Edit"),
                                    h("button", { type: "button", style: link, disabled: busy || !!editing, onClick: () => update({ deleteButtonizeRule: rule.id }, "Delete the Buttonize rule \"" + rule.name + "\"?") }, "Delete")))))),
                        editor,
                        !editing ? h("div", null, h("button", { type: "button", style: link, disabled: busy || rules === null, onClick: () => setEditing({ name: "", heading: "" }) }, "+ New rule")) : null,
                        error ? h("p", { role: "alert", className: "dsh-card-error", style: { margin: 0 } }, error) : null)));
        }
