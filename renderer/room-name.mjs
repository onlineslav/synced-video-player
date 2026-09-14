import {cleanText} from './profile.mjs'

export const MAX_ROOM_NAME_LENGTH = 80
const MAX_REVISION = 2 ** 48

export function cleanRoomDetails(details) {
  if (typeof details?.name !== 'string' || details.name.length > 320 ||
      !Number.isSafeInteger(details.revision) || details.revision <= 0 || details.revision >= MAX_REVISION ||
      typeof details.updatedBy !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(details.updatedBy)) return null
  const name = cleanText(details.name, MAX_ROOM_NAME_LENGTH)
  return name ? {name, revision: details.revision, updatedBy: details.updatedBy} : null
}

export function newerRoomDetails(details, previous) {
  return !previous || details.revision > previous.revision ||
    (details.revision === previous.revision && details.updatedBy > previous.updatedBy)
}

export function renameRoom(input, previous, selfId) {
  const name = cleanText(input, MAX_ROOM_NAME_LENGTH)
  if (!name || name === previous?.name) return previous
  const revision = (previous?.revision || 0) + 1
  if (revision >= MAX_REVISION) throw new Error('This room has reached its revision limit. Open a new room.')
  return {name, revision, updatedBy: selfId}
}
