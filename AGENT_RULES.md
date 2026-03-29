# AGENT RULES — STRICT EXECUTION CONSTRAINTS

## Environment Assumptions (DO NOT VIOLATE)
- Node.js is already installed system-wide.
- Use system Node: /usr/bin/node
- Use system npm: /usr/bin/npm
- NEVER install Node locally.
- NEVER download or bootstrap Node in the project directory.

## Dependency Rules
- DO NOT reinstall dependencies if they already exist and work.
- DO NOT run npm install more than once unless explicitly instructed.
- If node_modules exists, assume dependencies are installed.

## Directory Restrictions
- NEVER read, analyze, or traverse:
  - node_modules/
  - .git/
  - build/
  - dist/

- Treat these directories as invisible unless explicitly required.

## Execution Rules
- Before any setup step, you MUST run:
  - which node
  - node -v
  - npm -v

- If these succeed:
  → You are FORBIDDEN from installing Node or altering the runtime.

## Anti-Loop Protection
- NEVER repeat the same command more than once.
- NEVER retry installation steps automatically.
- If a step fails twice:
  → STOP and report the error.

## Change Control
- DO NOT make broad or recursive file changes.
- ONLY modify files directly related to the task.

## Priority Order (MANDATORY)
1. Preserve existing environment
2. Avoid redundant work
3. Minimize changes
4. Ask for clarification if uncertain

## Failure Mode
If environment state is unclear:
→ ASK instead of guessing
→ DO NOT reset or reinstall anything