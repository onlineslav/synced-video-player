# Connection regression introduced in 0.4

## Reproduction

Run the same Electron runtime and installed transport dependency against each
tagged renderer, with disposable profiles and real local WebRTC connections:

```sh
node scripts/electron.js scripts/check-connection-regression.js --relay-outage v0.3.0 v0.4.0 working
```

The test disables discovery messages after establishing the first connection.
It deliberately exits unsuccessfully when the 0.4 comparison fails.

| Scenario during discovery outage | 0.3 | 0.4 | Fixed code |
| --- | --- | --- | --- |
| Connected friends join a room | Pass | Stuck joining | Pass |
| Room participants establish friend presence | Pass | Friends remain offline | Pass |
| Leave and rejoin using the existing friend connection | Pass | Initial connection failed | Pass |

## Cause and fix

0.4 changed media from `APP_ID` to `${APP_ID}-persistent-rooms` and added
`${APP_ID}-room-presence`. Trystero shares physical peer connections only within
an app ID. The change therefore replaced one reusable connection with separate
friend, media and presence connections. A working connection on one channel
could no longer carry discovery for another channel.

The fix restores a single transport app ID. Room IDs `persistent:<code>` and
`presence:<code>` keep the protocols separate, with the existing room passwords
and signed admission checks. The regression test also checks that friends and
media use the same physical peer connection.

Both participants need the fixed build for room joining. Saved room codes,
playlists, identities and friend lists retain their existing local storage.

## Scope of the evidence

Both unmodified releases pass ordinary same-machine public-discovery tests.
The controlled outage reproduces a specific regression; it does not establish
that this exact outage occurred on the two users' networks. Their precise
friend-connection error has not been captured.

The earlier experimental relay-selection and ICE-message changes were removed.
`npm run test:connections` now runs the fixed-code outage checks before release
packaging. `npm run test:discovery` separately exercises public Nostr discovery;
its peer connections still use the local machine, so it is not a cross-network
NAT traversal test.
