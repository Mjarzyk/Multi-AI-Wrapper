# Multi-AI-Wrapper — Development Setup (Windows)

This document defines the complete, authoritative setup required to continue
development of the Multi-AI-Wrapper Electron application on a new Windows machine.

This file is intentionally comprehensive so a fresh machine can be brought
to a working state without guesswork.

---

## System Requirements

- Windows 10 or Windows 11 (64-bit)
- Administrator rights for installs
- Internet access

---

## Required Software

Install the following before cloning the repository.

1) Git for Windows  
   - Provides git CLI used for source control

2) Node.js (LTS)  
   - Includes npm  
   - Required for dependency installation and Electron runtime

3) Visual Studio Code  
   - Primary development editor

4) GitHub CLI (optional)  
   - Convenience for authentication and repo management

---

## Repository Setup

Clone the repository:

git clone https://github.com/wandering-wampa/Multi-AI-Wrapper.git

Open the project folder in VS Code:

cd Multi-AI-Wrapper
code .

---

## Dependency Installation

From the repository root, install dependencies using the lockfile:

npm ci

Notes:
- Uses package-lock.json for deterministic installs
- node_modules must NOT be committed
- package-lock.json MUST be committed

---

## Development Workflow

Run the application in development mode:

npm run start

---

## Packaging / Builds

Packaging scripts are defined in package.json.

Example (Windows):

npm run package-win

Adjust based on the scripts currently defined in the repo.

---

## Sanity Checks

Verify required tooling:

node -v
npm -v
git --version

Confirm:
- npm ci completes without error
- npm run start launches the application

---

## Git Configuration

Recommended Git identity configuration:

- Use the GitHub noreply email
- Configure globally or per-repo

git config --global user.name "wandering-wampa"
git config --global user.email "YOUR_GITHUB_NOREPLY_EMAIL"

---

## Notes

- package-lock.json is authoritative and must remain committed
- node_modules must never be committed
- This document is the single source of truth for new development machines
