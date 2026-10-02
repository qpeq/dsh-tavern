		// Player personas (name = {{user}}, description injected before the card description) and their portraits.
		const PERSONAS_CHANGED = "dsh-tavern-personas-changed";
		function notifyPersonasChanged() { window.dispatchEvent(new Event(PERSONAS_CHANGED)); }

		// Same-named personas are told apart by the first description line they don't share.
		function personaLabel(persona, personas) {
			const twins = (personas || []).filter(item => item.name === persona.name);
			if (twins.length < 2) return persona.name;
			const lines = text => String(text || "").split("\n").map(line => line.replace(/^[\s#>*\-]+/, "").replace(/\*\*/g, "").trim()).filter(Boolean);
			const others = new Set(twins.filter(item => item.id !== persona.id).flatMap(item => lines(item.description)));
			const own = lines(persona.description).find(line => !others.has(line)) || lines(persona.description)[0] || "";
			return own ? persona.name + " — " + (own.length > 32 ? own.slice(0, 32) + "…" : own) : persona.name;
		}

		function resizePortraitFile(file, maxSize = 512) {
			return new Promise((resolve, reject) => {
				const url = URL.createObjectURL(file), image = new Image();
				image.onload = () => {
					URL.revokeObjectURL(url);
					const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
					const canvas = document.createElement("canvas");
					canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
					canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
					const webp = canvas.toDataURL("image/webp", 0.88);
					resolve(webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.88));
				};
				image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
				image.src = url;
			});
		}

		function usePersonaLibrary() {
			const [state, setState] = React.useState({ loaded: false, personas: [], defaultId: "", portraits: {}, error: "" });
			const load = React.useCallback(async () => {
				try {
					const [settings, portraits] = await Promise.all([rpc("getTavernSettings"), rpc("getPersonaPortraits")]);
					setState({ loaded: true, personas: settings.settings?.personas || [], defaultId: settings.settings?.defaultPersonaId || "", portraits: portraits.portraits || {}, error: "" });
				} catch (err) { setState(current => ({ ...current, loaded: true, error: String(err.message || err) })); }
			}, []);
			React.useEffect(() => { load(); window.addEventListener(PERSONAS_CHANGED, load); return () => window.removeEventListener(PERSONAS_CHANGED, load); }, [load]);
			return { ...state, reload: load };
		}

		function PersonaPortrait({ src, name, size = 48 }) {
			const style = { width: size + "px", height: size + "px", borderRadius: "8px", flex: "0 0 auto", objectFit: "cover", objectPosition: "top" };
			if (src) return React.createElement("img", { src, alt: name ? name + " portrait" : "Portrait", style });
			return React.createElement("div", { "aria-hidden": true, style: { ...style, display: "grid", placeItems: "center", background: "var(--dsh-tavern-accent-soft, rgba(127,127,127,.18))", fontSize: Math.round(size * 0.42) + "px", fontWeight: 600, opacity: .8 } }, String(name || "?").slice(0, 1));
		}

		function PersonaEditor({ library, initial, onDone }) {
			const h = React.createElement;
			const [draft, setDraft] = React.useState(initial), [portrait, setPortrait] = React.useState(initial.id ? library.portraits[initial.id] || null : null);
			const [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
			const fileRef = React.useRef(null);
			async function pick(event) {
				const file = event.target.files && event.target.files[0]; event.target.value = "";
				if (!file) return;
				try { setPortrait(await resizePortraitFile(file)); } catch (err) { setError(String(err.message || err)); }
			}
			async function save() {
				setBusy(true); setError("");
				try {
					const before = new Set(library.personas.map(item => item.id));
					const result = await rpc("updateTavernSettings", { patch: { savePersona: { ...(draft.id ? { id: draft.id } : {}), name: draft.name, description: draft.description } } });
					const id = draft.id || (result.settings.personas || []).map(item => item.id).find(item => !before.has(item));
					const previous = draft.id ? library.portraits[draft.id] || null : null;
					if (id && portrait !== previous) await rpc("setPersonaPortrait", { personaId: id, dataUrl: portrait });
					notifyPersonasChanged(); onDone();
				} catch (err) { setError(String(err.message || err)); }
				finally { setBusy(false); }
			}
			return h("div", { className: "dsh-tavern-persona-editor", style: { display: "grid", gap: "10px", minWidth: 0, padding: "12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" } },
				h("div", { style: { display: "flex", gap: "12px", alignItems: "center", minWidth: 0 } },
					h(PersonaPortrait, { src: portrait, name: draft.name, size: 96 }),
					h("div", { style: { display: "grid", gap: "6px" } },
						h("input", { ref: fileRef, type: "file", accept: "image/*", hidden: true, onChange: pick }),
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: () => fileRef.current && fileRef.current.click() }, portrait ? "Replace portrait" : "Upload portrait"),
						portrait ? h("button", { type: "button", className: "dsh-tavern-btn quiet", disabled: busy, onClick: () => setPortrait(null) }, "Remove portrait") : null)),
				h("label", { style: { display: "grid", gap: "6px", minWidth: 0, fontSize: "12px" } }, "Name (used as {{user}})", h("input", { value: draft.name, maxLength: 80, disabled: busy, style: { width: "100%", boxSizing: "border-box" }, onChange: event => setDraft({ ...draft, name: event.target.value }) })),
				h("label", { style: { display: "grid", gap: "6px", minWidth: 0, fontSize: "12px" } }, "Description", h("textarea", { value: draft.description, rows: 16, maxLength: 20000, disabled: busy, style: { width: "100%", minHeight: "320px", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", fontSize: "14px", lineHeight: 1.5, padding: "10px" }, onChange: event => setDraft({ ...draft, description: event.target.value }) })),
				h("div", { style: { display: "flex", gap: "8px" } },
					h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !draft.name.trim(), onClick: save }, busy ? "Saving…" : "Save"),
					h("button", { type: "button", className: "dsh-tavern-btn quiet", disabled: busy, onClick: onDone }, "Cancel")),
				error ? h("p", { role: "alert", className: "dsh-card-error" }, "Save failed: " + error) : null);
		}

		// Lives at the top of the 酒馆状态 panel body: this game's persona, then the persona library.
		const PERSONA_LINK = { padding: "2px 0", border: 0, background: "transparent", color: "var(--dsh-tavern-accent)", font: "inherit", fontSize: "12px", cursor: "pointer", flex: "none" };
		const PERSONA_FULL = { width: "100%", minWidth: 0, boxSizing: "border-box" };
		function TavernPersonaPanel({ sessionId }) {
			const h = React.createElement;
			const library = usePersonaLibrary();
			const [current, setCurrent] = React.useState(undefined), [editing, setEditing] = React.useState(null);
			const [busy, setBusy] = React.useState(false), [status, setStatus] = React.useState("");
			React.useEffect(() => {
				let active = true;
				rpc("getConversationPersona", { sessionId }, sessionId).then(result => { if (active) setCurrent(result.persona || null); }, err => { if (active) { setCurrent(null); setStatus("Failed to load: " + err.message); } });
				return () => { active = false; };
			}, [sessionId]);
			async function choose(personaId) {
				setBusy(true); setStatus("Saving…");
				try {
					const result = await rpc("setConversationPersona", { sessionId, personaId }, sessionId);
					setCurrent(result.persona || null); setStatus("Saved. Player name is now \"" + result.playerName + "\". Applies from the next turn.");
					liveTavernView.invalidate(sessionId); notifyTavernDataChanged(["sessions"], "personas");
				} catch (err) { setStatus("Save failed: " + err.message); }
				finally { setBusy(false); }
			}
			async function update(patch, confirmText) {
				if (confirmText && !window.confirm(confirmText)) return;
				setBusy(true); setStatus("");
				try { await rpc("updateTavernSettings", { patch }); notifyPersonasChanged(); }
				catch (err) { setStatus("Save failed: " + err.message); }
				finally { setBusy(false); }
			}
			const personas = library.personas, known = current && personas.some(item => item.id === current.id);
			const options = () => personas.map(item => h("option", { key: item.id, value: item.id }, personaLabel(item, personas)));
			const section = (title, ...children) => h("section", { className: "dsh-tavern-status-section", style: { display: "grid", gap: "10px", minWidth: 0 } }, h("div", { className: "dsh-tavern-status-label" }, title), ...children);
			return h("div", { className: "dsh-tavern-persona-panel", style: { display: "grid", gap: "4px", minWidth: 0, paddingBottom: "12px", marginBottom: "18px", borderBottom: "1px solid var(--dsw-alias-border-l2)" } },
				section("Player persona · this game",
					h("div", { style: { display: "grid", gridTemplateColumns: "56px minmax(0, 1fr)", gap: "12px", alignItems: "center" } },
						h(PersonaPortrait, { src: current && library.portraits[current.id], name: current ? current.name : "", size: 56 }),
						h("select", { className: "dsh-tavern-settings-select", "aria-label": "Player persona for this game", value: current ? current.id : "", disabled: current === undefined || busy || !library.loaded, style: PERSONA_FULL, onChange: event => choose(event.target.value) },
							h("option", { value: "" }, "No persona"),
							current && !known ? h("option", { value: current.id }, current.name + " (deleted from the library)") : null,
							options())),
					status ? h("div", { role: "status", className: "dsh-tavern-settings-desc", style: { margin: 0 } }, status) : null),
				section("Persona library",
					h("label", { style: { display: "grid", gap: "6px", minWidth: 0, fontSize: "12px" } }, "Default for new games",
						h("select", { className: "dsh-tavern-settings-select", disabled: busy || !library.loaded, value: library.defaultId, style: PERSONA_FULL, onChange: event => update({ defaultPersonaId: event.target.value }) },
							h("option", { value: "" }, "No persona"), options())),
					library.error ? h("p", { role: "alert", className: "dsh-card-error" }, library.error) : null,
					h("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "10px", minWidth: 0 } }, personas.map(item => h("li", { key: item.id, style: { display: "grid", gridTemplateColumns: "48px minmax(0, 1fr)", gap: "12px", alignItems: "start", minWidth: 0 } },
						h(PersonaPortrait, { src: library.portraits[item.id], name: item.name, size: 48 }),
						h("div", { style: { display: "grid", gap: "2px", minWidth: 0 } },
							h("div", { style: { fontWeight: 600, fontSize: "13px", overflowWrap: "anywhere" } }, personaLabel(item, personas)),
							h("div", { style: { fontSize: "12px", lineHeight: 1.5, opacity: .7, overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } }, item.description ? item.description.replace(/\s+/g, " ").slice(0, 300) : "(no description)"),
							h("div", { style: { display: "flex", gap: "14px" } },
								h("button", { type: "button", style: PERSONA_LINK, disabled: busy || !!editing, onClick: () => setEditing({ id: item.id, name: item.name, description: item.description }) }, "Edit"),
								h("button", { type: "button", style: PERSONA_LINK, disabled: busy || !!editing, onClick: () => update({ deletePersona: item.id }, "Delete persona \"" + personaLabel(item, personas) + "\"? Games already started keep it.") }, "Delete")))))),
					editing ? h(PersonaEditor, { key: editing.id || "new", library, initial: editing, onDone: () => setEditing(null) })
						: h("div", null, h("button", { type: "button", style: PERSONA_LINK, disabled: busy || !library.loaded, onClick: () => setEditing({ name: "", description: "" }) }, "+ New persona"))));
		}
