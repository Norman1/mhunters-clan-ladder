// Reliability (strike/cooldown) rules shared by matchmaker and docs.
const UNRELIABLE_STRIKE_THRESHOLD = 2;
const UNRELIABLE_MAX_COOLDOWN_WEEKS = 12;
const UNRELIABLE_WEEKS_PER_STRIKE = 2;
const UNRELIABLE_COOLDOWN_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getUnreliableCooldownMs(missedGames) {
    const weeks = Math.min(
        UNRELIABLE_MAX_COOLDOWN_WEEKS,
        UNRELIABLE_WEEKS_PER_STRIKE * Math.max(1, missedGames - (UNRELIABLE_STRIKE_THRESHOLD - 1))
    );

    return weeks * UNRELIABLE_COOLDOWN_WEEK_MS;
}

module.exports = { UNRELIABLE_STRIKE_THRESHOLD, getUnreliableCooldownMs };
