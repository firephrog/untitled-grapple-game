# untitled-grapple-game
a game where you use grappling hooks and bombs to pvp your opponent

The actual code is in the master branch

This game is going to be browser based, although I might make a cross-playable downloadable version.

Currently a WIP, No planned release date yet

## EC2 (c7i-flex.large) Tuned Run

For AWS EC2 c7i-flex.large (2 vCPU, 4 GB RAM), use the tuned launcher profile:

./start.sh --ec2

What this profile changes:
- Runs a single shared C++ backend process for both PVP and FFA.
- Lowers state/patch pressure to avoid CPU starvation on 2 vCPU.
- Uses smaller Node heap settings suitable for 4 GB instances.
- Applies more conservative gRPC/Redis retry and keepalive defaults.

## Forgot Password Email Setup (Brevo)

Set these environment variables before starting the server:

- `BREVO_API_KEY` - Brevo API key used to send transactional emails.
- `BREVO_SENDER_EMAIL` - from-address for recovery/support emails.
- `BREVO_SENDER_NAME` - sender display name.
- `SUPPORT_EMAIL` - where in-game "contact support" requests are sent.
- `PASSWORD_RESET_CODE_TTL_MIN` - recovery code expiration in minutes (default `10`).

The forgot-password flow now supports:

- Sending a recovery code email.
- Resending recovery code (5-minute cooldown).
- Contacting support by email (5-minute cooldown).
