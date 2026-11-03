# Changelog

All notable changes to the Fast Grade (local_fastgrade) plugin are documented here.

## [v1.4.1] - 2026-11-04

### Release

- New Moodle version number (2026110400) so the release pipeline accepts it as newer than the build already promoted as v1.4.0 (2026110300). Includes every change listed under v1.3.1.

## [v1.3.1] - 2026-11-03

### Fixes

- Photo check (AI): the buttons and the cost question now read naturally for one photo ("Check the photo with AI", "Send 1 photo for 2 credits?") instead of "1 photo(s)".
- Photo check (AI): a negative credit balance from LMS Labs is treated as unknown and is no longer shown as "-1 credits left".
- Photo check (AI): a performance criterion checked only by a Photo check is no longer auto-filled from the text rules. Before, a photo submission had "Not shown yet" and the lowest level pre-filled on those criteria, even after using the AI's suggested level. Now they are left for the marker and the AI suggestion, and the Auto tab no longer shows an empty "Not found (0/0)" text result for them.
- Photo check (AI): the results panel no longer cuts off text on the right in a narrow marking pane; each item's evidence wraps under it.
- Tested against the live LMS Labs AI service with photos from bricklaying, hairdressing, welding, early childhood and aged care practicals.

## [v1.3.0] - 2026-11-02

### Maths marking (no AI)

- More topics checked line by line: inequalities (including quadratic inequalities, and a flagged slip when the sign is not flipped after dividing by a negative), simultaneous equations (two linear equations, or a line and a curve, with follow-through after a substitution slip) and integration (indefinite integrals checked by differentiating back, definite integrals checked by value). Trigonometric identities and proofs are not checked yet; those lines show Not checked.
- Final answers for simultaneous equations are read across lines ("y = 2" then "x = 3"), and Similar answers groups them by their (x, y) pairs.
- The student guide now shows how to type integrals, inequalities and simultaneous equations.

### Fixes

- The student list's filter now shows the saved choice when the marking screen opens. Before, it could show "Needs marking" while the list was filtered by an older choice such as Marked, so the list looked empty ("Nothing matches").
- A wrong final answer with no single expected value (an inequality or an integral) now says "Check the final answer." instead of ending with an empty "The expected answer is .". A correct integral after an earlier slip is shown as correct, not as follow-through.

### Optional AI photo checks (LMS Labs credits)

Everything above still works without AI. This is an optional extra, off by default.

- Photo check (AI): a teacher adds it to a criterion in Set up checks and lists what the photo should show (for example "Salmon in the centre of the plate"). In the marking screen, a marker presses Check photos with AI, sees the cost and confirms. LMS Labs AI suggests, for each criterion, whether the photo shows each thing, with its evidence and one thing to improve. A Use level button fills the rubric level only when the marker presses it.
- Read the working with AI: for a maths question, LMS Labs AI types out handwritten working exactly as written, and the maths engine (no AI) checks every line.
- Cost: 2 LMS Labs credits per photo, using the same Site ID and API key as the other LMS Labs plugins. Results are kept, so the same photo and criteria are never charged twice. A photo that cannot be checked is not charged.
- Settings: step-by-step instructions, a green "Connected to LMS Labs AI" light with the credit balance, a permission box that must be ticked before anything is sent, and the learners' ages (default: some under 18).
- Privacy: only the photo (resized, with location and camera data removed), the task and the criteria are sent; no names or user IDs. Results are covered by the Moodle privacy API and deleted with the activity.

## [v1.2.0] - 2026-11-01

### Maths marking (no AI)

- Maths working check: a built-in maths engine (computer algebra, running in the marker's browser) reads typed working one line at a time and checks that each line follows from the line before. The first line that does not follow is flagged in amber with the reason, and later lines that follow on from it are credited as follow-through.
- Final answers are checked by value, so x = -1/2, x = -0.5 and "x = 3, x = -1/2" are all the same answer. Equations, factorising, fractions, indices, logarithms, surds, the quadratic formula (with ±), differentiation are covered.
- Ready to go: a quiz question or assignment brief with an equation in it gets the maths check automatically. The expected answer comes from the equation itself, or from the grader information, or from a model answer you type.
- Works with your criteria: rubric, marking guide and question criteria about method or working are judged on the steps, and criteria about accuracy or the answer on the final answer. Suggested levels and scores fill in for you to check.
- Final answers: Similar answers on a maths question groups students by their final answer, so you can mark each different answer once.
- Mark stamps for photographed working: stamp M1, A1, B1, ft or A0 on each line of a photo or scan. Fast Grade finds the lines of writing on the page (plain image processing, no AI), places each stamp at the end of the line, adds up the marks and puts the total in the grade box when you choose. Press L for the stamp tool, and L again for the next mark.
- How students should submit their working: copyable instructions for typed working and for photos, and a box to try typed working against the engine, in Set up checks.

### Fixes

- Photos and files attached to quiz essay answers now open in the marking screen (they could fail to load).
- Similar answers keeps the line breaks in plain-text quiz answers.
- Similar answers also groups differentiation answers by their gradient value.

## [v1.1.2] - 2026-10-27

### Theme compatibility

- Buttons, tabs and icons now look the same in every theme. Some themes (Academi, for example) style every button and its hover state site-wide, which left white text on a white background when you hovered. Fast Grade's own styles now take priority over theme button and link styles.
- Hovering no longer changes text colour. Hovers only add a light background tint, a border or an underline, so text stays readable in any theme and in dark mode.
- Keyboard focus shows a clear blue outline on every Fast Grade button and link.

### Fixes

- Leader lines point to the right line when the commented text wraps over several lines.
- Positive and neutral suggested cells in spreadsheets use green and blue outlines instead of amber.
- Rule titles in the Live feedback panel no longer wrap mid-title.
- Auto-marking no longer ends a part label on a small word such as "so" or "but".

## [v1.1.1] - 2026-10-27

### Site access

- Verify the existing LMS Labs site unlock before staff grading, reporting, exports and web services.
- Use shared AI Configuration credentials, with optional per-plugin credentials in settings.
- Checking access never charges credits. Acquire the one-time 50-credit unlock through the explicit LMS Labs confirmation.
- Preserve student access to previously delivered feedback and standard Moodle grading.

## [v1.1.0] - 2026-10-27

### Auto-marking

- Auto-mark all: run the checks on every submission still waiting and keep each result as a draft for a marker to check and approve. A progress card shows each submission as it is marked and has a Stop button. Nothing is released, and work a marker has started is left alone.
- No setup needed. Ready-made checks are built from what each activity already has:
  - the assignment description and Activity instructions;
  - PDF or text files attached to the instructions, such as an assessment brief;
  - rubric and marking guide criteria, plus the instruction step each criterion matches;
  - other grading forms, such as Assignment Benchmarks, read through Moodle's grading form API;
  - essay grader information, question text, response template and word limits;
  - online text word limits.
- Where checks come from: an admin setting (on by default) and a per-activity choice in Set up checks.
- New Key ideas check: finds each idea in a criterion anywhere in the work, in everyday words too. For example, barriers and guards count as controls, likelihood and consequence count as a risk rating, and "lesson" counts as learning.
- Instruction parsing: list steps, questions in one sentence ("what…, how… and what…"), "Question 1:" prompts, word limits, referencing styles and legislation named in full.
- Partial credit: a criterion that is partly met suggests a middle level instead of the lowest. Key ideas carry more weight on slides and spreadsheets.
- PowerPoint: speaker notes count as evidence, and criteria about speaker notes are measured by how many slides have useful notes.
- Excel: spreadsheets are now auto-marked, with marks on cells. Criteria about formulas are measured by how many totals use formulas, and criteria about calculations by whether totals add up (including grand totals with a contingency). Wrong totals are flagged on the cell.
- Answered parts are marked as evidence on the sentence that answers them. Single shared words (a title or heading) no longer count.
- Clearer suggested feedback ("Aim for 150–300 words (this has 52)", "Add a reference list at the end"), with repeated points removed.
- Word limits and layout checks weigh a quarter as much as content when an answer is marked.

### Marking screen

- Thin leader lines join each comment card to its mark, in the card's colour (amber for improvement, green for positive). They highlight when you hover.
- Double-clicking a paragraph in a PDF now selects exactly that paragraph at any zoom. Before, overlapping text layers could select the whole page or misplace the highlight.
- Panel tabs keep readable hover colours under themes that darken buttons on hover.

## [v1.0.0] - 2026-10-27

This is the first release.

### Grading

- Marking screens for assignments and quiz essay questions, with annotation, voice feedback, rubrics, marking guides and a comment bank.
- Auto-marking without AI:
  - It fills in levels, remarks, annotations, overall feedback and the grade for the marker to review and approve.
  - It uses the rubric's own descriptions when no rules are set.

### Download

- Download all submissions for an assignment or a quiz essay question, either the latest version or every version.

### Report

- The report covers criteria, markers, feedback, auto-marking, integrity and workload.
- It has filters, a pivot table, saved and shared views, print to PDF, and CSV, Excel, ODS and JSON export.

### Integrations, data and support

- EssayGuard and DocGuard panels.
- Beacon metrics and reports (needs Beacon 2.10).
- Backup and restore, privacy provider, and clean-up when an activity or course is deleted.
- Supports Moodle 4.4, 4.5, 5.0, 5.1, 5.2 and 5.3.

### Fixes before release

- Auto-marking:
  - Headings and single table cells no longer count as evidence.
  - A table is judged as one block.
  - PDF lines that wrap mid-sentence are joined back up.
  - Word forms such as "prioritise" and "priorities" are matched.
- Reference check:
  - Recognises organisation authors such as Safe Work Australia.
  - No longer mistakes "(WA 2020)" for a citation.
  - Joins references that wrap over several lines.
- Selecting text in a PDF no longer jumps to the end of the page when the drag ends between lines.
- Quiz essays show the question above the answer.
- In the margin's pin view, the selected comment opens so it can be read, accepted or rejected.
- The comment box grows with the text.
- The top bar no longer overlaps the attempt picker on narrower screens.
- Radio buttons use a round focus ring.
- Focus mode and hiding the student list no longer collapse the marking screen.

### Code quality
- Passes the Moodle coding standard (moodle-cs) with no errors.
- Added the LICENSE file (GNU GPL v3).
- Multi-line calls and arrays laid out one argument per line.
- Database recordsets are always closed.
- Page scripts check capabilities explicitly.
- JSON web service parameters are documented; private notes use PARAM_TEXT.
