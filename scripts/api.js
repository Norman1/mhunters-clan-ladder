require('dotenv').config();

const BASE_URL = 'https://www.warzone.com/API';

/**
 * Creates a game using the Warzone API.
 * @param {number} templateId - The ID of the template to use.
 * @param {Array} players - Array of objects { PlayerID, Team }.
 * @param {string} gameName - Name of the game.
 * @returns {Promise<Object>} - API response.
 */
async function createGame(templateId, players, gameName = 'Ladder Match', personalMessage = '') {
  const email = process.env.WZ_EMAIL;
  const token = process.env.WZ_API_TOKEN;

  if (!email || !token) {
    throw new Error('Missing WZ_EMAIL or WZ_API_TOKEN in environment variables.');
  }

  const payload = {
    hostEmail: email,
    hostAPIToken: token,
    templateID: templateId,
    gameName: gameName,
    personalMessage: personalMessage,
    players: players
  };

  const response = await fetch(`${BASE_URL}/CreateGame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`API Error: ${data.error}`);
  }

  return data;
}


/**
 * Polls the status of a game.
 * @param {string} gameId - The ID of the game to check.
 * @returns {Promise<Object>} - API response containing game state.
 */
async function pollGameStatus(gameId) {
  const email = process.env.WZ_EMAIL;
  const token = process.env.WZ_API_TOKEN;

  if (!email || !token) {
    throw new Error('Missing WZ_EMAIL or WZ_API_TOKEN in environment variables.');
  }

  // Java implementation uses Form URL Encoded for GameFeed
  const params = new URLSearchParams();
  params.append('Email', email);
  params.append('APIToken', token);
  params.append('GameID', gameId);

  const response = await fetch(`${BASE_URL}/GameFeed?GameID=${gameId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`API Error: ${data.error}`);
  }

  return data;
}


/**
 * Deletes a game.
 * @param {string} gameId - The ID of the game to delete.
 * @returns {Promise<Object>} - API response.
 */
async function deleteGame(gameId) {
  const email = process.env.WZ_EMAIL;
  const token = process.env.WZ_API_TOKEN;

  if (!email || !token) {
    throw new Error('Missing WZ_EMAIL or WZ_API_TOKEN in environment variables.');
  }

  const payload = {
    Email: email,
    APIToken: token,
    gameID: gameId
  };

  const response = await fetch(`${BASE_URL}/DeleteLobbyGame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`API Error: ${data.error}`);
  }

  return data;
}

module.exports = { createGame, pollGameStatus, deleteGame };
