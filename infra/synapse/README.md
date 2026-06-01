# Synapse staging notes

This folder is reserved for the Kodiak Connect v2 staging Matrix server.

## Staging identity

Use staging-only Matrix identity while v2 is under construction:

```text
server name: v2.kodiak-connect.com
public base URL: https://matrix-v2.kodiak-connect.com/
```

Staging accounts and rooms are disposable.

## Production identity later

Do not create final production users until the final production Matrix identity is chosen and locked.

Expected final production direction:

```text
server name: kodiak-connect.com
public base URL: https://matrix.kodiak-connect.com/
```

## Config generation

Generate a fresh Synapse config on the VPS, then adapt it for PostgreSQL and reverse proxy use.

Keep generated runtime config and private values out of git.
