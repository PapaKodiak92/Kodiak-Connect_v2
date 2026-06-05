# Kodiak Connect Website

This folder contains the standalone public landing page for `kodiak-connect.com`.

The production app is intentionally kept separate from this website. The current app entrypoint, app shell, Matrix login flow, backend configuration, desktop packaging, and mobile packaging are not changed by these files.

## Structure

- `index.html` - public marketing homepage
- `styles.css` - standalone site styling

## Brand wording

Use `Kodiak Holdings` as the public brand name.

Do not use `Kodiak Holdings LLC` until the legal entity exists.

## Deployment direction

The intended domain layout is:

- `kodiak-connect.com` - public website
- `www.kodiak-connect.com` - redirect to public website
- `app.kodiak-connect.com` - future web app portal
- `auth.kodiak-connect.com` - authentication service
- `api.kodiak-connect.com` - backend API service
- `matrix.kodiak-connect.com` - Matrix service

## Safety rule

Changes in this folder should not modify the live app experience unless a future deployment step explicitly points the root domain to this static website.
