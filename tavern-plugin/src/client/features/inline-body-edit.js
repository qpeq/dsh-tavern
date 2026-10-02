		// Editing the latest reply in place: the dock's 编辑正文 button opens it, and the assistant
		// renderer swaps that reply's body for the editor. Shared state, since the two live in different modules.
		const inlineBodyEdit = { value: null, listeners: new Set() };
		function setInlineBodyEdit(value) {
			inlineBodyEdit.value = value;
			inlineBodyEdit.listeners.forEach(listener => listener(value));
		}
		function useInlineBodyEdit() {
			const [value, setValue] = React.useState(inlineBodyEdit.value);
			React.useEffect(() => { inlineBodyEdit.listeners.add(setValue); setValue(inlineBodyEdit.value); return () => { inlineBodyEdit.listeners.delete(setValue); }; }, []);
			return value;
		}
		async function openInlineBodyEdit(sessionId) {
			const result = await rpc("getBodyEdit", {}, sessionId);
			setInlineBodyEdit({ sessionId, edit: result.edit, texts: result.edit.parts.filter(part => part.kind === "text").map(part => part.text), busy: false, error: "" });
		}

		function InlineBodyTextarea({ value, disabled, label, onChange, onKeyDown, autoFocus }) {
			const ref = React.useRef(null);
			// Grow with the text, so editing looks like the reply itself rather than a scroll box.
			React.useLayoutEffect(() => {
				const area = ref.current;
				if (!area) return;
				area.style.height = "auto";
				area.style.height = area.scrollHeight + 2 + "px";
			}, [value]);
			React.useEffect(() => { if (autoFocus && ref.current && ref.current.offsetParent !== null) { ref.current.focus({ preventScroll: true }); ref.current.setSelectionRange(0, 0); } }, []);
			return React.createElement("textarea", { ref, value, disabled, "aria-label": label, rows: 3, onChange, onKeyDown,
				style: { display: "block", width: "100%", boxSizing: "border-box", resize: "none", overflow: "hidden", font: "inherit", lineHeight: "inherit", color: "inherit",
					background: "var(--dsw-specific-input-major, transparent)", border: "1px solid var(--dsh-tavern-accent, #c96)", borderRadius: "8px", padding: "10px 12px" } });
		}

		function InlineBodyEditor({ panel }) {
			const h = React.createElement;
			const regionRef = React.useRef(null);
			// Open with the reply's start at the top of the chat, not wherever the bottom-anchored view left it.
			// Repeat on the next frames: the chat viewport may re-anchor to the bottom as the boxes grow.
			React.useLayoutEffect(() => {
				const region = regionRef.current;
				if (!region || region.offsetParent === null) return;
				const top = () => region.scrollIntoView({ block: "start", behavior: "auto" });
				top();
				let frames = 0, id = requestAnimationFrame(function again() { top(); if (++frames < 6) id = requestAnimationFrame(again); });
				return () => cancelAnimationFrame(id);
			}, []);
			async function save() {
				if (panel.busy) return;
				setInlineBodyEdit({ ...panel, busy: true, error: "" });
				try {
					const result = await rpc("saveBodyEdit", { token: panel.edit.token, texts: panel.texts }, panel.sessionId);
					liveTavernView.setView(panel.sessionId, result.view);
					notifyTavernDataChanged(["sessions"], "body-edit");
					tavernCoordination.invalidate(panel.sessionId);
					setInlineBodyEdit(null);
				} catch (error) { setInlineBodyEdit({ ...inlineBodyEdit.value, busy: false, error: String(error.message || error) }); }
			}
			function keys(event) {
				if (event.key === "Escape" && !panel.busy) { event.preventDefault(); setInlineBodyEdit(null); }
				else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); }
			}
			let textIndex = 0, focused = false;
			return h("div", { ref: regionRef, className: "dsh-tavern-inline-body-edit", role: "region", "aria-label": "Edit reply", style: { display: "grid", gap: "10px", scrollMarginTop: "8px" } },
				panel.edit.parts.map((part, index) => {
					if (part.kind === "html") return h("div", { key: index, className: "dsh-tavern-question-sub", style: { fontSize: "12px", opacity: .7 } }, "(HTML block kept as is)");
					if (part.kind !== "text") return null;
					const current = textIndex++, autoFocus = !focused;
					focused = true;
					return h(InlineBodyTextarea, { key: index, label: "Reply text " + (current + 1), value: panel.texts[current], disabled: panel.busy, autoFocus, onKeyDown: keys, onChange: event => {
						const texts = panel.texts.slice(); texts[current] = event.target.value;
						setInlineBodyEdit({ ...inlineBodyEdit.value, texts });
					} });
				}),
				panel.error ? h("div", { className: "dsh-tavern-choice-error", role: "alert" }, panel.error) : null,
				h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
					h("button", { type: "button", className: "dsh-tavern-choice-trigger", disabled: panel.busy, onClick: save }, panel.busy ? "Saving…" : "Save"),
					h("button", { type: "button", className: "dsh-tavern-choice-trigger", disabled: panel.busy, onClick: () => setInlineBodyEdit(null) }, "Cancel"),
					h("span", { style: { fontSize: "12px", opacity: .6 } }, "Ctrl+Enter saves · Esc cancels")));
		}
