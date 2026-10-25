# Rotapp changelog

Newest first. One entry per version; older files are not kept, so this is the record of what changed.

## 0.6 — 25 Oct 2026
- UI v2.0: Dark-first look, with a light version (mirror of dark); Auto follows the phone. New shift colours and a ring on today.
- New app icon: shift stripes (green, blue, yellow on dark).
- Leave tab redesigned: tap the year to switch to the previous year (read-only, no Add leave) and back; "Counting from October" note when a year starts part-way; C and Sick counts can be hidden; Other shows only if used that year.
- Allowance is now kept per year. Settings has a new Leave card (after Appearance) for this year's allowance and carry-over, and which counts show on the Leave tab. A new year copies last year's allowance; carry-over starts at 0.
- The temporary allowance fields at the bottom of the Leave tab are gone.

## 0.5 — 25 Oct 2026
- Import now stores everyone's rows, grouped by office as in the rota (people not in the most recent import drop off the list).
- Import preview has a "Showing" picker to check any person's months.
- Settings → Rota → "Showing" switches Week and Month to another person, shown with a grey "· view only" pill; their days can't be edited.
- Swap shifts from the day editor: pick the person (London and Dubai by default, set by tick boxes in Settings), then their day (current month, next month behind "Show"), check, confirm. Both people exchange shifts on each day involved. Only this month and next can be swapped.
- Settings redesigned as cards: blue Import card at the top with Backup behind its arrow, then Rota (Showing, swap groups, Week view, This is me) and Appearance. One card open at a time.
- Holiday allowance and carry-over moved to the bottom of the Leave tab (stopgap until the Leave redesign).
- Backups include everyone's rows.

## 0.4 — 24 Oct 2026
- New swipe: only the days or week cards slide; header, weekday letters and summary stay still.
- 900 ms snap with a soft ease-out; fast repeated swipes and arrow taps always register, even mid-slide.
- Month title rolls like a slot machine as you drag.
- Month frame is always 6 rows, with shorter months centred.

## 0.3 — 24 Oct 2026
- Plain ↺ between the left chevron and the title jumps back to today; shows from two months or weeks away. Replaces the Today pill.

## 0.2 — 24 Oct 2026
- Swipe between weeks and months, following your finger; arrows kept.
- App opens on the current month.
- "Today" pill beside the title when away from today.

## 0.1 — 24 Oct 2026
- First working prototype: Week, Month, Leave and Settings.
- Import from PDF or xlsx with preview, warnings and "already has data, replace it?".
- Day editing, Add leave, backup export and import, offline use, light and dark themes.
