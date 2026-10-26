# Fast Grade (local_fastgrade)

Fast Grade replaces two Moodle marking screens:

- the assignment grader
- the quiz manual-grading screen for essay questions

It works on Moodle 4.4 to 5.3. It is a standalone plugin. It shares no code with other graders, and Fast Grade itself calls no outside services. Nothing in it uses AI.

## What markers get

**Mark on the work itself.** Highlight, underline, box, strike or pin a comment on PDFs, Word documents (converted to PDF when the site has a document converter set up), images and online text. Every mark is either Positive (green) or Improvement (amber). Fast Grade never puts red on a student's work.

**Voice feedback.** Dictate any comment. Speech is turned into text in the marker's browser. The default is on-device only. A site can also allow the browser's own speech service. Fast Grade records how much feedback was spoken.

**Rubrics and marking guides.** These sit beside the work, each with a remark box per criterion. A comment bank, keyboard shortcuts and "Save & next" keep the flow fast.

**Auto-marking (no AI).** For each criterion the teacher sets key points, required terms and minimum word counts. If no rules are set, they come from the rubric's own descriptions. Fast Grade fills in a draft for every submission:

- levels
- remarks
- annotations on covered points
- an overall Strengths / To improve comment
- the grade

The marker reviews, edits and approves the draft. Nothing reaches a student until it is approved.

**Download all submissions.** Download the whole assignment, or one quiz essay question, as a ZIP. Choose the latest version only or every version, with one folder per student.

**Integrations.** Fast Grade shows EssayGuard and DocGuard results when those plugins are installed. It adds marking metrics and reports to Beacon (2.10 or later).

## The report

The report opens from the chart icon in the grader, or from the activity menu. It has these tabs:

- Overview
- Criteria
- Questions
- Markers
- Feedback
- Auto-marking
- Integrity
- Workload

The report also offers:

- filters on every field
- a pivot table
- saved and shared views
- print to PDF
- export to CSV, Excel, ODS or JSON

Levels use one colour scale everywhere:

| Level | Colour |
|---|---|
| Lowest | #d00180 |
| Third | #fe8500 |
| Second | #0176ee |
| Top | #22c65e |

## Install

1. Copy the folder to `local/fastgrade` and visit *Site administration > Notifications*.
2. Settings are in *Site administration > Plugins > Local plugins > Fast Grade*.

## Capabilities

| Capability | Default roles | What it allows |
|---|---|---|
| `local/fastgrade:grade` | Teacher, Editing teacher, Manager | Use Fast Grade to mark. Marking also needs the activity's own grading capability. |
| `local/fastgrade:managecriteria` | Editing teacher, Manager | Set auto-marking rules for an activity. |
| `local/fastgrade:managecoursebank` | Editing teacher, Manager | Edit the course comment bank. |
| `local/fastgrade:managesitebank` | Manager | Edit the site comment bank. |
| `local/fastgrade:viewfeedback` | Student, Teacher, Editing teacher, Manager | See annotated feedback on returned work. |
| `local/fastgrade:viewreport` | Teacher, Editing teacher, Manager | Open the report and export it. |

## Privacy and backup

- The privacy API covers every table.
- Annotations, feedback history and marking data are included in activity backup and restore. Rubric criteria are remapped on restore.
- Deleting an activity or course removes its Fast Grade data.

## Tests

```
vendor/bin/phpunit --testsuite local_fastgrade_testsuite
```

## Licence

GNU GPL v3 or later. Third-party libraries are listed in `thirdpartylibs.xml`: pdf.js, pdf-lib and WordNet.

© 2026 LMS Hosting Services / LMS Labs
