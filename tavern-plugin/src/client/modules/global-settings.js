// Settings owns its initial snapshot; each editor saves only its own resource.
function createGlobalSettingsModule({ React, rpc, notifySettingsChanged, TavernDefaultModelSetting, TavernConversationWritingSkills, DisplayPreferencesSettings, CandidatePreferencesSettings, PromptTemplateSettingsEntry, ContextCompactionSettings, SceneImageSettings }) {
    function GlobalPlayDefaults({ settings }) {
        const h = React.createElement;
        const [data, setData] = React.useState(null), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState("");
        React.useEffect(() => {
            let active = true;
            Promise.all([rpc("listPresets"), rpc("getUserPreferenceProfile", { globalDefaults: true })]).then(([presets, profile]) => {
                if (active) setData({ ...settings.defaultPlaySettings, presets: presets.presets || [], preset: presets.activePresetPath || "", profile: profile.userProfile });
            }, err => { if (active) setMessage("读取失败：" + err.message); });
            return () => { active = false; };
        }, []);
        async function save(patch, method, args) {
            setBusy(true); setMessage("");
            try {
                const result = await rpc(method || "updateTavernSettings", args || { patch: { defaultPlaySettings: patch } });
                if (method === "selectPreset") setData(current => ({ ...current, preset: args.path }));
                else if (method === "manageUserPreferenceProfile") {
                    const profile = await rpc("getUserPreferenceProfile", { globalDefaults: true });
                    setData(current => ({ ...current, profile: profile.userProfile }));
                } else setData(current => ({ ...current, ...result.settings.defaultPlaySettings }));
                setMessage("已保存，新游戏继承此设置，已有游戏保持不变。");
            } catch (err) { setMessage("保存失败：" + err.message); }
            finally { setBusy(false); }
        }
        const disabled = !data || busy;
        function toggle(key, title, help, task) {
            return h("label", { key, className: "dsh-tavern-settings-row dsh-tavern-background-task" },
                h("span", { className: "dsh-tavern-settings-copy" }, h("strong", { className: "dsh-tavern-settings-title" }, title), h("span", { className: "dsh-tavern-settings-desc" }, help)),
                h("input", { type: "checkbox", role: "switch", "aria-label": title, disabled, checked: task ? data?.backgroundTasks[key] === true : data?.[key] === true, onChange: event => save(task ? { backgroundTasks: { [key]: event.target.checked } } : { [key]: event.target.checked }) }));
        }
        return h("div", { className: "dsh-tavern-settings-section dsh-local-settings dsh-tavern-global-defaults" },
            h("section", { className: "dsh-local-section" }, h("h3", null, "基本信息"),
                h("label", { className: "dsh-local-field" }, "默认玩家称呼", h("input", { key: data?.playerName, defaultValue: data?.playerName || "", disabled, maxLength: 80, onBlur: event => { if (event.target.value !== data.playerName) save({ playerName: event.target.value }); } })),
                h("label", { className: "dsh-local-field" }, "默认状态栏位置", h("select", { disabled, value: data?.statusBarPlacement || "sidebar", onChange: event => save({ statusBarPlacement: event.target.value }) }, h("option", { value: "sidebar" }, "侧边栏"), h("option", { value: "body" }, "正文下方"))),
                h("label", { className: "dsh-local-field" }, "默认预设", h("select", { disabled, value: data?.preset || "", onChange: event => save(null, "selectPreset", { path: event.target.value }) }, h("option", { value: "" }, "不使用外部预设"), (data?.presets || []).filter(item => item.valid && item.recognized).map(item => h("option", { key: item.path, value: item.path }, item.title)))),
                h("label", { className: "dsh-local-field" }, "默认长期偏好", h("select", { disabled, value: data?.profile.defaultProfileId || "", onChange: event => save(null, "manageUserPreferenceProfile", { action: "default", profileId: event.target.value }) }, h("option", { value: "" }, "不启用"), (data?.profile.profiles || []).filter(item => item.hasConfirmed).map(item => h("option", { key: item.id, value: item.id }, item.name))))),
            h("section", { className: "dsh-local-section" }, h("h3", null, "后台结算"),
                toggle("variables", "变量结算", "MVU 卡建议开启；普通卡不执行此任务。", true), toggle("posture", "人物姿势结算", "总结本轮结束时人物的位置、动作和姿势。", true)),
            h("section", { className: "dsh-local-section" }, h("h3", null, "扩展功能"),
                toggle("webSearchEnabled", "联网搜索", "允许新游戏的前台和后台按需搜索。"), toggle("sceneImagesEnabled", "开启场景生图", "允许手动为剧情配图；API 在下方统一配置。")),
            message ? h("p", { role: "status" }, message) : null);
    }

    // Player personas: who {{user}} is. New games use the default one; each game can switch in its own settings.
    function PersonaSettings({ settings }) {
        const h = React.createElement;
        const [personas, setPersonas] = React.useState(settings.personas || []), [defaultId, setDefaultId] = React.useState(settings.defaultPersonaId || "");
        const [editing, setEditing] = React.useState(null), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState("");
        async function save(patch, done) {
            setBusy(true); setMessage("");
            try {
                const result = await rpc("updateTavernSettings", { patch });
                setPersonas(result.settings.personas || []); setDefaultId(result.settings.defaultPersonaId || "");
                notifySettingsChanged(); if (done) done(); setMessage("Saved");
            } catch (err) { setMessage("Save failed: " + err.message); }
            finally { setBusy(false); }
        }
        const editor = editing ? h("div", { className: "dsh-tavern-persona-editor" },
            h("label", { className: "dsh-local-field" }, "Name (used as {{user}})", h("input", { value: editing.name, maxLength: 80, disabled: busy, onChange: event => setEditing({ ...editing, name: event.target.value }) })),
            h("label", { className: "dsh-local-field" }, "Description", h("textarea", { value: editing.description, rows: 6, maxLength: 20000, disabled: busy, onChange: event => setEditing({ ...editing, description: event.target.value }) })),
            h("div", { className: "dsh-tavern-persona-actions" },
                h("button", { type: "button", disabled: busy || !editing.name.trim(), onClick: () => save({ savePersona: editing }, () => setEditing(null)) }, "Save"),
                h("button", { type: "button", disabled: busy, onClick: () => setEditing(null) }, "Cancel"))) : null;
        return h("div", { className: "dsh-tavern-settings-section dsh-local-settings dsh-tavern-persona-settings" },
            h("section", { className: "dsh-local-section" },
                h("label", { className: "dsh-local-field" }, "Default persona for new games", h("select", { disabled: busy, value: defaultId, onChange: event => save({ defaultPersonaId: event.target.value }) },
                    h("option", { value: "" }, "No persona"), personas.map(item => h("option", { key: item.id, value: item.id }, item.name)))),
                h("ul", { className: "dsh-tavern-persona-list" }, personas.map(item => h("li", { key: item.id },
                    h("span", { className: "dsh-tavern-settings-copy" }, h("strong", null, item.name), h("span", { className: "dsh-tavern-settings-desc" }, item.description ? item.description.slice(0, 120) + (item.description.length > 120 ? "…" : "") : "(no description)")),
                    h("button", { type: "button", disabled: busy || !!editing, onClick: () => setEditing({ id: item.id, name: item.name, description: item.description }) }, "Edit"),
                    h("button", { type: "button", disabled: busy || !!editing, onClick: () => { if (window.confirm("Delete persona \"" + item.name + "\"? Games already started keep it.")) save({ deletePersona: item.id }); } }, "Delete")))),
                editor || h("button", { type: "button", disabled: busy, onClick: () => setEditing({ name: "", description: "" }) }, "New persona")),
            message ? h("p", { role: "status" }, message) : null);
    }

    function TavernSettingsSection() {
        const [state, setState] = React.useState({ loading: true, busy: false, defaultForegroundModel: null, defaultBackgroundModel: null, defaultWorkbenchModel: null, notice: "", settings: null, modelCatalog: [], sceneImages: false, error: "" });
        React.useEffect(function () {
            let active = true;
            rpc("getTavernSettings").then(function (result) {
                if (active) setState({ loading: false, busy: false, defaultForegroundModel: result.settings?.defaultForegroundModel || null, defaultBackgroundModel: result.settings?.defaultBackgroundModel || null, defaultWorkbenchModel: result.settings?.defaultWorkbenchModel || null, notice: "", settings: result.settings, modelCatalog: Array.isArray(result.modelCatalog) ? result.modelCatalog : [], sceneImages: Boolean(result.releaseCapabilities && result.releaseCapabilities.sceneImages), error: "" });
            }, function (error) {
                if (active) setState(function (current) { return Object.assign({}, current, { loading: false, busy: false, error: String(error && error.message || error) }); });
            });
            return function () { active = false; };
        }, []);
        async function saveDefault(name, selection) {
            if (state.loading || state.busy) return;
            setState(current => ({ ...current, busy: true, error: "", notice: "" }));
            try {
                const result = await rpc("updateTavernSettings", { patch: { [name]: selection } });
                notifySettingsChanged();
                setState(current => ({ ...current, [name]: result.settings[name], busy: false, notice: name === "defaultWorkbenchModel" ? "已保存，下次新建工作台对话生效" : "已保存，下次新游戏生效" }));
            } catch (err) { setState(current => ({ ...current, busy: false, error: String(err.message || err) })); }
        }
        const h = React.createElement;
        function group(title, desc, ...children) {
            return h("section", { className: "dsh-tavern-gs-group", "aria-label": title },
                h("header", { className: "dsh-tavern-gs-head" }, h("h2", null, title), desc ? h("p", null, desc) : null),
                ...children);
        }
        return h("div", { className: "dsh-tavern-settings-section dsh-tavern-global-settings" },
            group("默认模型", "用于新游戏和新的卡片工作台对话，已有对话保持当前配置。建议使用 High 推理强度；Max 容易过度思考、增加等待。",
            h("div", { className: "dsh-tavern-gs-card" },
            React.createElement(TavernDefaultModelSetting, { label: "默认前台模型", title: "前台模型", fallback: "使用 DSH 默认模型", selection: state.defaultForegroundModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultForegroundModel", selection) }),
            React.createElement(TavernDefaultModelSetting, { label: "默认后台模型", title: "后台模型", fallback: "跟随前台", selection: state.defaultBackgroundModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultBackgroundModel", selection) }),
            React.createElement(TavernDefaultModelSetting, { label: "卡片工作台默认模型", title: "工作台模型", fallback: "跟随前台", selection: state.defaultWorkbenchModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultWorkbenchModel", selection) })),
            state.notice ? h("p", { className: "dsh-tavern-gs-notice", role: "status" }, state.notice) : null),
            group("Player personas", "The persona name is used as {{user}}; its description is injected right before the character description. Pick one when starting a game, or switch later in the game's own settings.",
                state.settings ? h(PersonaSettings, { settings: state.settings }) : null),
            group("新游戏默认", "开局时继承，开局后可在本局设置中单独修改。",
                state.settings ? h(GlobalPlayDefaults, { settings: state.settings }) : null,
                h(TavernConversationWritingSkills, { globalDefaults: true })),
            group("显示与交互", "",
                h(DisplayPreferencesSettings),
                h(CandidatePreferencesSettings)),
            group("高级", "",
                h(PromptTemplateSettingsEntry),
                h(ContextCompactionSettings),
                state.sceneImages ? h(SceneImageSettings, null) : null),
            state.error ? React.createElement("div", { className: "dsh-tavern-settings-error", role: "alert" }, "保存失败：" + state.error) : null
        );
    }

    return { TavernSettingsSection };
}
