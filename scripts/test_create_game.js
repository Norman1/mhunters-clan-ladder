const { createGame } = require('./api');

// Test Configuration
const TEMPLATE_ID = process.env.TEST_TEMPLATE_ID;
const P1 = process.env.TEST_P1_ID;
const P2 = process.env.TEST_P2_ID;

(async () => {
    console.log('--- Warzone API Test ---');

    if (!process.env.WZ_EMAIL || !process.env.WZ_API_TOKEN) {
        console.error('ERROR: Missing WZ_EMAIL or WZ_API_TOKEN in .env file.');
        process.exit(1);
    }

    if (!TEMPLATE_ID || !P1 || !P2) {
        console.error('ERROR: Missing Test Config. Please set TEST_TEMPLATE_ID, TEST_P1_ID, and TEST_P2_ID in .env file.');
        process.exit(1);
    }

    try {
        console.log(`Creating test game...`);
        console.log(`Template: ${TEMPLATE_ID}`);
        console.log(`Players: ${P1} vs ${P2}`);

        const players = [
            { PlayerID: P1, Team: 0 },
            { PlayerID: P2, Team: 1 }
        ];

        const result = await createGame(TEMPLATE_ID, players, "Automated API Test Game");
        console.log('\nSUCCESS! Game created.');
        console.log('Game ID:', result.gameID);
        // Note: Check response format. Usually { gameID: ... }
    } catch (err) {
        console.error('\nFAILED to create game.');
        console.error(err.message);
        process.exit(1);
    }
})();
