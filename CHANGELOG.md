# Changelog

All notable changes to the Fast Grade (local_fastgrade) plugin are documented here.

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
