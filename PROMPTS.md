# AI Assistance & Prompts Log

**Software Engineer Intern Technical Assignment — Sezzle Inc.**

| | |
|---|---|
| **AI tool used** | Claude (Anthropic) |
| **Responsible** | Danilo Tangarife Bustamante |

In accordance with Sezzle's technical assignment guidelines, AI tooling was used throughout the design, implementation, and refinement of this project. Below is an organized log of the primary prompts used across key project phases.

This log is a representative selection of the primary prompts used and does not include every interaction with AI tools during development.

> *Note: The prompts were originally written in Spanish and have been translated into English for this document.*

---

## 1. Project Scoping & Architectural Planning
Used to establish clean code principles, repository structure, and technical constraints before writing code.

> **Prompt:**
> "I am in a selection process for a company as a Software Engineer Intern at Sezzle Inc... [Full assignment text provided].
>
> I need you to understand the problem and what is being asked. Have the skeleton, folder structure, languages (Go backend, React + TypeScript frontend), REST API, dockerization, CI/CD, unit tests, and possible improvements in mind.
>
> You must understand that it is very important to lay out the foundations of this project clearly, so that during development it is clear where we want to go... everything must be designed with good programming practices, SOLID principles, scalable code, and a testable architecture."

> **Prompt:**
> "We can now begin building the project... During implementation I want us to keep software engineering best practices in mind: readable code, well-separated responsibilities, low coupling, ease of testing, consistent error handling, SOLID principles, and avoiding over-engineering. If any decision turns out to be unnecessarily complex, propose a simpler alternative."

---

## 2. Business Logic, Operator Precedence & API Behavior
Used to refine the evaluation algorithm, implement chained operator precedence, and define edge cases.

> **Prompt:**
> "The program flow currently requires entering a number, an operation, another number, and then pressing the equals sign. I want the user to enter any operation they wish, with as many numbers and operators as needed (e.g., `9+8*8/4-1`), respecting the order of operations. In addition, the calculator should display the result live at the bottom as terms are entered."

> **Prompt:**
> "The standalone percentage case is missing: for example, entering `25%` in the calculator should return `0.25`. Also, exponentiation with parentheses must follow mathematical rules: `-2^4` must return `-16` (the exponent only affects the 2), while `(-2)^4` must return `16` (it affects the whole block). This behavior needs to be fixed."

---

## 3. UI/UX Edge Cases, Input Rules & Formatting
Used to align the frontend behavior with standard calculator UX expectations.

> **Prompt:**
> "The message shown on division by zero should be clear, something like 'can't divide by zero', so the user understands the error.
>
> Regarding percentages: it should support both converting to a decimal (`25%` → `0.25`) and calculating 'percentage of' (e.g., `50% of 10` yielding `5`)."

> **Prompt:**
> "With parentheses: when a parenthesis is closed, the text should not immediately turn into the result; instead, the operation should remain visible inside the parentheses so the user can edit it.
>
> Additionally, if a number appears right after a closing parenthesis, or right before an opening one, it should be interpreted as an implicit multiplication: `9(2)` → `9×2`."

> **Prompt:**
> "There is a detail when multiplying negative numbers: when entering `4 * -4`, parentheses should be automatically placed around the negative number so the expression is not corrupted, instead of inserting extra zeros. If `+` is pressed immediately after `*`, the addition should replace the previous operator."

---

## 4. Documentation & Setup
Used to summarize project architecture and build execution instructions.

> **Prompt:**
> "Help me structure the documentation and the README with the following sections: Overview, Prerequisites, Run Instructions, API Examples (cURL), Tests & Coverage, and Design Decisions / Assumptions."
