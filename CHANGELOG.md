# Rotapp changelog

Newest first. One entry per version; older files are not kept, so this is the record of what changed.

## 0.8 — 26 Oct 2026
Built from the UI chat's build notes (build-notes-animations.md and build-notes-ui.md). Every animation now moves only with transform and opacity, so it can run at the iPhone's full 120 Hz.
- Day editor sheet: slides up with the iOS sheet curve (450 ms) and the dim fades with it. It opens at normal height; swipe up for ¾ of the screen, where the editor stays fixed and only Who's on scrolls (a thin divider shows once it has scrolled). Drag down to shrink, flick down, tap the dim, Cancel or Done to close. Cancel and Done sit on their own pinned bar. The sheet can be caught mid-slide. Replaces the 0.7.6 "below the fold" layout. Desktop keeps the side panel.
- The same sheet is used for the person picker (tapping search expands it), Bank holidays worked and Booked leave (normal height only).
- Swap steps slide in from the right inside the sheet like iOS navigation; step 1 expands the sheet; the bottom bar's buttons change per step with a fade. Choosing a day moves the outline instantly.
- Import pop-ups (and the Remove confirmation) fade in with a slight scale-up; each next step dips out and back in; closing fades out.
- Add leave and Change leave slide in over the Leave tab, which slides 30% left under a soft shade. Change dates closes the booked-leave sheet and opens Change leave together.
- Segmented controls (Week view, Day style, Theme, Add leave type) have one sliding highlight; the screen updates when it lands. Add leave type is now a segmented control.
- Toasts drop in from the top and fade away.
- Settings cards and the rows inside them (Groups in the swap list, Who's on and its offices, People) open with transform-only slides; Who's on sections in the day editor too. Tab switching stays instant.
- Swap markers: swapped days get a corner triangle on Month and Week in the colour of the shift they replaced (Off: black in dark mode, white in light), on other people's rotas too.
- Edit notes: each changed day keeps a small note (what it was, swap or edit, and with whom). The day editor shows a line under the date, e.g. "M → L (edited by you)" or "(swapped with Brooke)". Leave clears notes on its days; re-importing a month clears that month's notes; backups include the notes.
- Reduced motion: everything jumps straight to the end state.

## 0.7.6 — 26 Oct 2026
- Person chip under the Week and Month titles: "Me ▾", or the person's name with "view only" and a ✕ to go back to you. Tap it to open a sheet with search, "Back to me" at the top and everyone grouped by office.
- Settings → Rota → Showing has a "Me" button to the left of the dropdown (greyed out while you're showing yourself).
- Day editor: "Who's on" sits below the swap button, revealed by scrolling. Everyone working that day, grouped by shift (yours first and open, the rest collapsed) and then by office, with each shift's time and head count. When you're off, every shift starts collapsed. Cancel and Done stay pinned at the bottom. On desktop the list shows straight away in the side panel.
- Settings → Rota: new "Who's on" row to choose offices, and people within them, for that list. Everyone is shown to start with; new people show if their office is ticked; unticking only hides them from the list.
- "Groups in the swap list" is now a summary row that opens in place, like People.

## 0.7.5 — 25 Oct 2026
- People list moved into the Rota card: a "People · N people" row at the bottom of the card opens the list in place (closed by default). The separate People card is gone.

## 0.7 — 25 Oct 2026
- C days: 1 C day earned for each English bank holiday worked on M, L, MA, LA or E, counted automatically. Leave tab has a C block (left of earned) and a "Bank holidays worked" sheet with a +/− adjust. Unused C days reset each January.
- Add leave has a C option (works like Sick; warns if C would go below zero, still lets you save).
- Day editor: Holiday is greyed out on Saturdays and Sundays; warns when a single day takes Holiday over the allowance or C below zero (still lets you save). Shows the shift time in the header.
- Week cards show the shift time under the letter (M 08:00–16:30, L 15:00–23:30, E 23:00–07:30).
- New year carry-over is worked out from last year's unused Holiday, capped at 2 (still editable).
- People list: everyone ever imported stays; a People card in Settings (closed by default, summary only) lets you remove anyone (their shifts are deleted until reimported); names missing from the latest import show "last seen".
- Import preview has a People section (closed by default) to skip people or whole offices; skipped and removed people start unticked next time; skipping leaves their existing shifts alone.
- Settings cards open and close with a smooth slide and fade; the version line sits at the bottom of Settings.

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
