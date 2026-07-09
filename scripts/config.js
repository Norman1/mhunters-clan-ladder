// Shared constants for the M'Hunters ladder backend.
const CLAN_ID = '141'; // M'Hunters clan on war.app

const clanPageUrl = (clanId = CLAN_ID) => `https://war.app/Clans/?ID=${clanId}`;
const profilePageUrl = (playerId) => `https://war.app/Profile?p=${playerId}`;

module.exports = { CLAN_ID, clanPageUrl, profilePageUrl };
