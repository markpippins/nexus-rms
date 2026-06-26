# Nebula UI — Specification

## Functional Requirements

- Organize projects into a three-level hierarchy: Systems → Subsystems → Features
- Manage requirements via a Kanban board with drag-and-drop status transitions
- Provide a sortable table view for bulk editing and review
- Support contextual README documentation at every hierarchy level
- Leverage AI (Gemini 2.5 Flash) to decompose user stories into technical tasks
- Persist all data to localStorage for offline availability
- Support dark/light theme toggling with persistent preference

## Non-Functional Requirements

- Angular 21+ with zoneless change detection for optimal performance
- Signal-based state management with computed properties
- Tailwind CSS for responsive, modern UI
- AI context-aware generation using documentation from current System/Subsystem/Feature

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| (UI) | System selection | Navigate hierarchy in sidebar |
| (UI) | Board view | Drag-and-drop requirement management |
| (UI) | Table view | Sortable list-based requirement editing |
| (UI) | AI generation | Decompose user story into tasks |
| (UI) | Doc editing | Edit contextual documentation per level |

## Data Model

- System: id (UUID), name (String), description (String), readme (String), subsystems (Subsystem[]), createdAt (Instant)
- Subsystem: id (UUID), systemId (UUID), name (String), description (String), readme (String), features (Feature[]), color (String)
- Feature: id (UUID), subsystemId (UUID), name (String), description (String), readme (String)
- Requirement: id (UUID), systemId (UUID), subsystemId (UUID), featureId (UUID), title (String), description (String), status (String), priority (String)
