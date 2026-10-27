# Changelog

All notable changes to the Fast Grade (local_fastgrade) plugin are documented here.

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
