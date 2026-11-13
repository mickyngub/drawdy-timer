# Changelog

## 1.1.1

Timers on a view-only board

- on a board shared view-only, people watch timers tick but can't change them; a press on the timer, the rail button, the right-click menu or the panel shows "View only: ask for edit access to change timers" at the top of the screen for a moment instead
- the panel says View only at the top and holds back its timer controls; the sound choice still works, since it belongs to each device
- a view-only screen no longer writes the finished state at zero; people who can edit the board still do
- on a Drawdy without view-only support, Timer works as in 1.1.0

## 1.1.0

The timer is now a widget on the board that everyone sees ticking, with or without Timer

- the widget shows big digits, a ring that drains as time runs, the label and the state, and counts down on every screen from the same end time
- Start, Pause or Resume, +1 min and Reset sit on the widget; pressing one needs Timer, so people without it watch the countdown
- in the last 10 seconds the ring and digits turn amber and pulse gently; at zero it reads "Time's up", pulses for 5 seconds, then holds
- at zero the first button turns from Pause to Start again: the screen of whoever last pressed writes the finished timer, which adds 2 undo steps for them, and anyone else with Timer writes it 5 seconds later if that screen is closed
- the widget follows the board's light or dark theme on each screen
- the countdown pill now shows only while the running timer is off screen or too small to read
- each press swaps the widget for a new one, so undoing a press takes two steps
- 1.0.0 timer cards keep counting and turn into widgets the first time someone changes them

## 1.0.0

First public release

- a timer card on the board that everyone with Timer shares: start, pause, +1 min and reset from the panel or the right-click menu, each one undo step
- a countdown pill at the top of every screen, with digits that never shift, a gentle pulse in the last 10 seconds and "Time's up" at the end
- the card's name carries the state, such as "Running · ends 14:32", so people without the extension can read it
- presets of 1, 3, 5, 10, 15 and 25 minutes, any length up to 99, and a label
- a soft chime or a bell when time is up, made in the browser, chosen on each device
- several timers on one board: the pill shows whichever ends soonest
- the panel follows the board's light and dark themes
