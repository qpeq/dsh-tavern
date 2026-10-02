// Persona portraits live apart from tavern-settings.json (read on every request),
// as one JSON map of persona id -> image data URL. The browser shrinks uploads first.
const PORTRAIT_LIMIT = 2 * 1024 * 1024
const DATA_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/

export const PERSONA_PORTRAITS_PATH = 'persona-portraits.json'

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function validatePortrait(dataUrl) {
  if (dataUrl === null) return null
  if (typeof dataUrl !== 'string' || !DATA_URL.test(dataUrl)) throw new Error('Portrait must be a PNG, JPEG, WebP or GIF image')
  if (dataUrl.length > PORTRAIT_LIMIT) throw new Error('Portrait is too large (max 2 MB after resizing)')
  return dataUrl
}

/** Portraits whose persona still exists; a deleted persona's portrait is dropped. */
export function presentPortraits(document, personas) {
  const ids = new Set(personas.map(persona => persona.id))
  return Object.fromEntries(Object.entries(object(document)).filter(([id, url]) => ids.has(id) && typeof url === 'string'))
}

export function createPersonaPortraits(profileData) {
  return Object.freeze({
    async read(personas) { return presentPortraits(await profileData.readJson(PERSONA_PORTRAITS_PATH), personas) },
    async set(personaId, dataUrl, personas) {
      if (!personas.some(persona => persona.id === personaId)) throw new Error('Persona not found; refresh and try again')
      const portrait = validatePortrait(dataUrl)
      const next = await profileData.updateJson(PERSONA_PORTRAITS_PATH, current => {
        const map = presentPortraits(current, personas)
        if (portrait === null) delete map[personaId]
        else map[personaId] = portrait
        return map
      })
      return presentPortraits(next, personas)
    },
    async prune(personas) {
      await profileData.updateJson(PERSONA_PORTRAITS_PATH, current => {
        const kept = presentPortraits(current, personas)
        return Object.keys(kept).length === Object.keys(object(current)).length ? undefined : kept
      })
    }
  })
}
