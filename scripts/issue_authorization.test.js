const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the actual inline workflow gate, without checking out code, calling
// GitHub/Warzone, or running the mutating IssueOps script.
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/issues.yml'), 'utf8')
    .replace(/\r\n/g, '\n');
const steps = workflow.split(/^      - name: /m).slice(1);
const gate = steps[0];
const script = gate.split('          script: |\n')[1]
    .split('\n').map(line => line.replace(/^            /, '')).join('\n');
const guard = "        if: steps.authorize.outputs.allowed == 'true'";

function permission(username, role = 'write') {
    return {
        status: 200,
        data: {
            permission: role === 'maintain' ? 'write' : role,
            role_name: role,
            user: { login: username, id: username.toLowerCase() === 'editor' ? 42 : 84 }
        }
    };
}

async function authorize({ action = 'opened', actor = 'editor', initiator = actor,
    sender = { login: actor, id: 42 }, eventName = 'issues', title = 'Update: 123 Cap: 2',
    lookup = username => permission(username) } = {}) {
    const outputs = {};
    const failures = [];
    const calls = [];
    await vm.runInNewContext(`(async () => {\n${script}\n})()`, {
        core: {
            setOutput: (name, value) => { outputs[name] = value; },
            setFailed: message => failures.push(message)
        },
        context: {
            actor, eventName, repo: { owner: 'owner', repo: 'ladder' },
            payload: {
                action, sender,
                issue: { title, user: { login: 'owner' }, author_association: 'OWNER' }
            }
        },
        process: { env: { TRIGGERING_ACTOR: initiator } },
        github: { rest: { repos: {
            getCollaboratorPermissionLevel: async args => {
                calls.push({ ...args });
                return lookup(args.username);
            }
        } } }
    });
    return { outputs, failures, calls };
}

function denied(result) {
    assert.equal(result.outputs.allowed, 'false');
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /current repository write access/);
}

test('the gate precedes and explicitly guards every downstream step', () => {
    assert.match(workflow, /types: \[opened, edited\]/);
    assert.match(gate, /^Authorize IssueOps\n        id: authorize\n/);
    assert.match(gate, /uses: actions\/github-script@v7/);
    assert.match(gate, /TRIGGERING_ACTOR: \$\{\{ github.triggering_actor \}\}/);
    assert.equal(steps.length, 5);
    for (const step of steps.slice(1)) {
        assert.ok(step.split('\n').includes(guard), step.split('\n')[0]);
        assert.doesNotMatch(step, /continue-on-error:|always\(|failure\(/);
    }
    assert.doesNotMatch(gate, /continue-on-error:/);
    assert.doesNotMatch(script, /\$\{\{/);
    assert.match(workflow, /ISSUE_TITLE: \$\{\{ github.event.issue.title \}\}/);
    assert.match(workflow, /run: node scripts\/issue_ops.js/);
    assert.match(workflow, /permissions:\n      contents: write\n      issues: write/);
});

for (const action of ['opened', 'edited']) {
    for (const role of ['write', 'maintain', 'admin']) {
        test(`${action}: current ${role} permission authorizes execution`, async () => {
            const result = await authorize({ action, lookup: username => permission(username, role) });
            assert.equal(result.outputs.allowed, 'true');
            assert.deepEqual(result.failures, []);
            assert.deepEqual(result.calls, [{ owner: 'owner', repo: 'ladder', username: 'editor' }]);
        });
    }
    for (const role of ['none', 'read', 'triage', 'maintain', 'WRITE', '', null, undefined]) {
        test(`${action}: raw permission ${String(role)} cannot authorize`, async () => {
            // maintain is only accepted as the documented base permission write.
            denied(await authorize({ action, lookup: username => {
                const response = permission(username);
                response.data.permission = role;
                return response;
            } }));
        });
    }
    for (const title of ['Signup: 123 Name: Player', 'Update: 123 Cap: 3', 'Remove: 123',
        'AdmitGuest: 123 Cap: 2 Name: Friend', 'RevokeGuest: 123',
        'AddTemplate: 123 Name: Map', 'RemoveTemplate: 123', '$(echo injected)\n::notice::untrusted']) {
        test(`${action}: command text cannot bypass rejected permissions: ${JSON.stringify(title)}`, async () => {
            const result = await authorize({ action, title, lookup: username => permission(username, 'read') });
            denied(result);
            assert.ok(result.failures.every(message => !message.includes(title)));
        });
    }
}

test('an authorized editor may process an issue written by someone else', async () => {
    // The mocked issue author is owner; only the event sender is checked.
    const result = await authorize({ action: 'edited' });
    assert.equal(result.outputs.allowed, 'true');
    assert.equal(result.calls[0].username, 'editor');
});

test('a maintainer rerun cannot promote an untrusted original event', async () => {
    const result = await authorize({ initiator: 'maintainer', lookup: username =>
        permission(username, username === 'editor' ? 'read' : 'admin') });
    denied(result);
    assert.deepEqual(result.calls.map(call => call.username), ['editor']);
});

test('an untrusted rerun initiator cannot reuse a trusted event', async () => {
    const result = await authorize({ initiator: 'outsider', lookup: username =>
        permission(username, username === 'outsider' ? 'read' : 'write') });
    denied(result);
    assert.deepEqual(result.calls.map(call => call.username), ['editor', 'outsider']);
});

test('a rerun by a second trusted maintainer checks both current permissions', async () => {
    const result = await authorize({ initiator: 'maintainer' });
    assert.equal(result.outputs.allowed, 'true');
    assert.deepEqual(result.calls.map(call => call.username), ['editor', 'maintainer']);
});

test('revoked permissions are looked up again on a rerun', async () => {
    let role = 'write';
    const lookup = username => permission(username, role);
    assert.equal((await authorize({ lookup })).outputs.allowed, 'true');
    role = 'read';
    denied(await authorize({ lookup }));
});

test('case differences in GitHub logins do not deny valid maintainers', async () => {
    const result = await authorize({ actor: 'Editor', sender: { login: 'EDITOR', id: 42 }, initiator: 'editor' });
    assert.equal(result.outputs.allowed, 'true');
    assert.equal(result.calls.length, 1);
});

for (const change of [
    { sender: null }, { sender: {} },
    { sender: { login: 'outsider', id: 42 } },
    { sender: { login: 'editor', id: '42' } },
    { sender: { login: 'editor', id: 0 } },
    { actor: '' }, { actor: 42 }, { initiator: '' }, { initiator: null },
    { eventName: 'issue_comment' }, { action: 'closed' }
]) {
    test(`invalid event identity fails before API access: ${JSON.stringify(change)}`, async () => {
        const result = await authorize(change);
        denied(result);
        assert.equal(result.calls.length, 0);
    });
}

for (const response of [
    undefined, null, {}, { status: 200 }, { status: 200, data: null },
    { status: 200, data: { permission: 'write' } },
    { ...permission('editor'), status: 403 },
    permission('someone-else'),
    { status: 200, data: { permission: 'write', user: { login: 'editor', id: 999 } } },
    { status: 200, data: { permission: 'write', user: { login: 'editor', id: '42' } } }
]) {
    test(`unexpected permission response fails closed: ${JSON.stringify(response)}`, async () => {
        denied(await authorize({ lookup: () => response }));
    });
}

for (const status of [401, 403, 404, 429, 500, 'network failure']) {
    test(`permission lookup error ${status} fails closed without leaking error contents`, async () => {
        const result = await authorize({ lookup: () => {
            throw new Error(`secret-token and untrusted response body: ${status}`);
        } });
        denied(result);
        assert.doesNotMatch(result.failures.join('\n'), /secret-token|response body/);
    });
}

test('failure checking the rerun initiator also fails closed', async () => {
    denied(await authorize({ initiator: 'maintainer', lookup: username => {
        if (username === 'maintainer') throw new Error('unavailable');
        return permission(username);
    } }));
});
