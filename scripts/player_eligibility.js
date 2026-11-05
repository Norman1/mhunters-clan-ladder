// Legacy records without in_clan are clan members. Guest admission is an
// independent, explicit grant; it never changes factual clan membership.
function isLadderEligible(player) {
    return !!player && (player.in_clan !== false || player.guest === true);
}

module.exports = { isLadderEligible };
