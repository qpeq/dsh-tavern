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

		// Portraits are 2:3 like SillyTavern avatars, saved at up to 512x768.
		const PORTRAIT_ASPECT = 2 / 3, PORTRAIT_MAX_WIDTH = 512, CROP_MIN = 40;
		const CROP_CORNERS = { nw: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", se: "nwse-resize" };

		// SillyTavern-style crop dialog: a fixed-aspect box dragged by its body and resized from its corners.
		function PortraitCropper({ src, onCancel, onDone }) {
			const h = React.createElement;
			const imageRef = React.useRef(null), drag = React.useRef(null);
			const [size, setSize] = React.useState(null), [rect, setRect] = React.useState(null), [error, setError] = React.useState("");
			React.useEffect(() => {
				const key = event => { if (event.key === "Escape") onCancel(); };
				window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
			}, [onCancel]);
			function loaded() {
				const image = imageRef.current, w = image.clientWidth, ih = image.clientHeight;
				let cw = Math.min(w, ih * PORTRAIT_ASPECT);
				setSize({ w, h: ih }); setRect({ x: (w - cw) / 2, y: (ih - cw / PORTRAIT_ASPECT) / 2, w: cw });
			}
			function start(mode, event) {
				event.preventDefault(); event.stopPropagation();
				event.currentTarget.setPointerCapture(event.pointerId);
				drag.current = { mode, x: event.clientX, y: event.clientY, rect };
			}
			function move(event) {
				const d = drag.current;
				if (!d || !size) return;
				const dx = event.clientX - d.x, dy = event.clientY - d.y, r = d.rect, rh = r.w / PORTRAIT_ASPECT;
				if (d.mode === "move") {
					setRect({ w: r.w, x: Math.min(Math.max(0, r.x + dx), size.w - r.w), y: Math.min(Math.max(0, r.y + dy), size.h - rh) });
					return;
				}
				// Resize around the opposite corner, keeping the aspect and staying on the image.
				const sx = d.mode.includes("e") ? 1 : -1, sy = d.mode.includes("s") ? 1 : -1;
				const ax = sx > 0 ? r.x : r.x + r.w, ay = sy > 0 ? r.y : r.y + rh;
				const limit = Math.min(sx > 0 ? size.w - ax : ax, (sy > 0 ? size.h - ay : ay) * PORTRAIT_ASPECT);
				const w = Math.max(Math.min(CROP_MIN, limit), Math.min(limit, r.w + Math.max(sx * dx, sy * dy * PORTRAIT_ASPECT)));
				setRect({ w, x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - w / PORTRAIT_ASPECT });
			}
			function confirm() {
				try {
					const image = imageRef.current, scale = image.naturalWidth / size.w;
					const sw = rect.w * scale, sh = sw / PORTRAIT_ASPECT;
					const outW = Math.max(1, Math.round(Math.min(PORTRAIT_MAX_WIDTH, sw))), outH = Math.round(outW / PORTRAIT_ASPECT);
					const canvas = document.createElement("canvas");
					canvas.width = outW; canvas.height = outH;
					const context = canvas.getContext("2d");
					context.imageSmoothingQuality = "high";
					context.drawImage(image, rect.x * scale, rect.y * scale, sw, sh, 0, 0, outW, outH);
					const webp = canvas.toDataURL("image/webp", 0.9);
					onDone(webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.9));
				} catch (err) { setError(String(err.message || err)); }
			}
			const handle = corner => h("div", { key: corner, onPointerDown: event => start(corner, event), style: { position: "absolute", width: "16px", height: "16px", background: "#fff", border: "2px solid var(--dsh-tavern-accent, #c96)", borderRadius: "3px", boxSizing: "border-box", cursor: CROP_CORNERS[corner], touchAction: "none",
				[corner.includes("n") ? "top" : "bottom"]: "-8px", [corner.includes("w") ? "left" : "right"]: "-8px" } });
			return h("div", { role: "dialog", "aria-modal": true, "aria-label": "Crop portrait", style: { position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.72)", display: "grid", placeItems: "center", padding: "24px" } },
				h("div", { style: { display: "grid", gap: "14px", justifyItems: "center", padding: "18px", borderRadius: "14px", background: "var(--dsw-specific-sidebar-fill, #222)", color: "var(--dsw-alias-label-primary, #eee)", maxWidth: "100%" } },
					h("strong", null, "Crop portrait"),
					h("div", { style: { position: "relative", overflow: "hidden", userSelect: "none", lineHeight: 0 } },
						h("img", { ref: imageRef, src, alt: "", draggable: false, onLoad: loaded, onError: () => setError("Could not read that image"), style: { display: "block", maxWidth: "min(80vw, 900px)", maxHeight: "68vh" } }),
						rect ? h("div", { onPointerDown: event => start("move", event), onPointerMove: move, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; },
							style: { position: "absolute", left: rect.x + "px", top: rect.y + "px", width: rect.w + "px", height: rect.w / PORTRAIT_ASPECT + "px", boxSizing: "border-box", border: "2px solid #fff", boxShadow: "0 0 0 9999px rgba(0,0,0,.55)", cursor: "move", touchAction: "none" } },
							Object.keys(CROP_CORNERS).map(handle)) : null),
					h("div", { style: { fontSize: "12px", opacity: .75 } }, "Drag the box to move it; drag a corner to resize. Esc cancels."),
					error ? h("p", { role: "alert", className: "dsh-card-error", style: { margin: 0 } }, error) : null,
					h("div", { style: { display: "flex", gap: "10px" } },
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: !rect, onClick: confirm }, "Use this crop"),
						h("button", { type: "button", className: "dsh-tavern-btn quiet", onClick: onCancel }, "Cancel"))));
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

		function PersonaPortrait({ src, name, size = 64 }) {
			const style = { width: size + "px", height: Math.round(size / PORTRAIT_ASPECT) + "px", borderRadius: "8px", flex: "0 0 auto", objectFit: "cover", objectPosition: "top", display: "block" };
			if (src) return React.createElement("img", { src, alt: name ? name + " portrait" : "Portrait", style });
			return React.createElement("div", { "aria-hidden": true, style: { ...style, display: "grid", placeItems: "center", background: "var(--dsh-tavern-accent-soft, rgba(127,127,127,.18))", fontSize: Math.round(size * 0.42) + "px", fontWeight: 600, opacity: .8 } }, String(name || "?").slice(0, 1));
		}

		function PersonaEditor({ library, initial, onDone }) {
			const h = React.createElement;
			const [draft, setDraft] = React.useState(initial), [portrait, setPortrait] = React.useState(initial.id ? library.portraits[initial.id] || null : null);
			const [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
			const fileRef = React.useRef(null);
			const [crop, setCrop] = React.useState(null);
			function pick(event) {
				const file = event.target.files && event.target.files[0]; event.target.value = "";
				if (file) setCrop({ src: URL.createObjectURL(file), uploaded: true });
			}
			const closeCrop = React.useCallback(() => setCrop(current => { if (current && current.uploaded) URL.revokeObjectURL(current.src); return null; }), []);
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
					h(PersonaPortrait, { src: portrait, name: draft.name, size: 128 }),
					h("div", { style: { display: "grid", gap: "6px" } },
						h("input", { ref: fileRef, type: "file", accept: "image/*", hidden: true, onChange: pick }),
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: () => fileRef.current && fileRef.current.click() }, portrait ? "Replace portrait" : "Upload portrait"),
						portrait ? h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: () => setCrop({ src: portrait, uploaded: false }) }, "Crop portrait") : null,
						portrait ? h("button", { type: "button", className: "dsh-tavern-btn quiet", disabled: busy, onClick: () => setPortrait(null) }, "Remove portrait") : null)),
				crop ? h(PortraitCropper, { src: crop.src, onCancel: closeCrop, onDone: url => { setPortrait(url); closeCrop(); } }) : null,
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
					h("div", { style: { display: "grid", gridTemplateColumns: "96px minmax(0, 1fr)", gap: "14px", alignItems: "center" } },
						h(PersonaPortrait, { src: current && library.portraits[current.id], name: current ? current.name : "", size: 96 }),
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
					h("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "10px", minWidth: 0 } }, personas.map(item => h("li", { key: item.id, style: { display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", gap: "14px", alignItems: "start", minWidth: 0 } },
						h(PersonaPortrait, { src: library.portraits[item.id], name: item.name, size: 64 }),
						h("div", { style: { display: "grid", gap: "2px", minWidth: 0 } },
							h("div", { style: { fontWeight: 600, fontSize: "13px", overflowWrap: "anywhere" } }, personaLabel(item, personas)),
							h("div", { style: { fontSize: "12px", lineHeight: 1.5, opacity: .7, overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" } }, item.description ? item.description.replace(/\s+/g, " ").slice(0, 300) : "(no description)"),
							h("div", { style: { display: "flex", gap: "14px" } },
								h("button", { type: "button", style: PERSONA_LINK, disabled: busy || !!editing, onClick: () => setEditing({ id: item.id, name: item.name, description: item.description }) }, "Edit"),
								h("button", { type: "button", style: PERSONA_LINK, disabled: busy || !!editing, onClick: () => update({ deletePersona: item.id }, "Delete persona \"" + personaLabel(item, personas) + "\"? Games already started keep it.") }, "Delete")))))),
					editing ? h(PersonaEditor, { key: editing.id || "new", library, initial: editing, onDone: () => setEditing(null) })
						: h("div", null, h("button", { type: "button", style: PERSONA_LINK, disabled: busy || !library.loaded, onClick: () => setEditing({ name: "", description: "" }) }, "+ New persona"))));
		}
