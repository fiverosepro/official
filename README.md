# FiveRose site (GitHub Pages + Google Calendar schedule)

## How it works
- You input events in Google Calendar.
- GitHub Actions fetches the public ICS and generates `schedule.json` every 15 minutes.
- `index.html` fetches `schedule.json` and renders the schedule cards.

## Required images
- Put a default avatar at `images/default.png`.
- Optional: member icons as `images/<配信者名>.png` (same name as in `{配信者名}`).
