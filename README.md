# Qualitative Researcher MCP Server

An MCP server implementation that provides tools for managing qualitative research knowledge graphs, enabling structured representation of research projects, participants, interviews, observations, codes, themes, and findings. This server helps qualitative researchers organize their data, track their analysis process, develop themes, and generate insights from rich textual data.

## Features

- **Persistent Research Context**: Maintain a structured knowledge graph of research entities and relationships across multiple analysis sessions
- **Study Session Management**: Track research analysis sessions with unique IDs and record progress over time
- **Thematic Analysis**: Organize and track emergent themes across data sources
- **Coding Framework**: Manage hierarchical coding structures and track code applications
- **Participant Management**: Track participant data, demographics, and contributions
- **Data Source Organization**: Organize interviews, observations, and documents
- **Research Question Tracking**: Link data to specific research questions
- **Memo Writing**: Document analytical insights throughout the research process
- **Chronological Data Analysis**: Explore data in temporal sequence
- **Code Co-occurrence Analysis**: Identify relationships between different codes
- **Methodology Documentation**: Track methodological decisions and approaches

## Entities

The Qualitative Researcher MCP Server recognizes the following entity types:

- **project**: Overall research study
- **participant**: Research subjects
- **interview**: Formal conversation with participants
- **observation**: Field notes from observational research
- **document**: External materials being analyzed
- **code**: Labels applied to data segments
- **codeGroup**: Categories or families of related codes
- **memo**: Researcher's analytical notes
- **theme**: Emergent patterns across data
- **quote**: Notable excerpts from data sources
- **literature**: Academic sources
- **researchQuestion**: Formal questions guiding the study
- **finding**: Results or conclusions

## Relationships

Entities can be connected through the following relationship types:

- **participated_in**: Links participants to interviews/observations
- **codes**: Shows which codes apply to which data
- **contains**: Hierarchical relationship (e.g., codegroup contains codes)
- **supports**: Data supporting a theme or finding
- **contradicts**: Data contradicting a theme or finding
- **answers**: Data addressing a research question
- **cites**: References to literature
- **followed_by**: Temporal sequence
- **related_to**: General connection
- **reflects_on**: Memo reflecting on data/code/theme
- **compares**: Comparative relationship
- **conducted_by**: Person who conducted data collection
- **transcribed_by**: Person who transcribed data
- **part_of**: Entity is part of another entity
- **derived_from**: Entity is derived from another entity
- **collected_on**: Data collection date
- **analyzes**: Analysis relationship
- **triangulates_with**: Triangulation between data sources

## Available Tools

The Qualitative Researcher MCP Server provides these tools for interacting with research knowledge:

### startsession
Starts a new qualitative research session, generating a unique session ID and displaying current research projects, recent data collection, emergent themes, and previous sessions.

### loadcontext
Loads detailed context for a specific entity (project, participant, interview, etc.), displaying relevant information based on entity type.

### endsession
Records the results of a research session through a structured, multi-stage process:
1. **summary**: Records session summary, duration, and project focus
2. **interviewData**: Documents new interview data processed during the session
3. **memos**: Records analytical memos created during the session
4. **codingActivity**: Tracks new and revised codes applied to data
5. **themes**: Documents emergent or developed themes from analysis
6. **projectStatus**: Updates overall project status and observations
7. **assembly**: Final assembly of all session data

### buildcontext
Creates new entities, relations, or observations in the knowledge graph:
- **entities**: Add new research entities (projects, participants, interviews, etc.)
- **relations**: Create relationships between entities
- **observations**: Add observations to existing entities

### deletecontext
Removes entities, relations, or observations from the knowledge graph:
- **entities**: Remove research entities
- **relations**: Remove relationships between entities
- **observations**: Remove specific observations from entities

### advancedcontext
Retrieves information from the knowledge graph:
- **graph**: Get the entire knowledge graph
- **search**: Search for nodes based on query criteria
- **nodes**: Get specific nodes by name
- **related**: Find related entities

## Domain-Specific Functions

The Qualitative Researcher MCP Server includes specialized domain functions for qualitative research:

- **getProjectOverview**: Comprehensive view of a project including research questions, methodology, participants, data sources
- **getParticipantProfile**: Detailed profile of a participant including demographics, interviews, and quotes
- **getThematicAnalysis**: Analysis of themes with supporting codes and data
- **getCodedData**: View all data segments tagged with a specific code
- **getResearchQuestionAnalysis**: Organize data by research questions with related findings
- **getChronologicalData**: View data in temporal sequence
- **getCodeCooccurrence**: Analyze where multiple codes appear together
- **getMemosByFocus**: Retrieve all memos related to a specific entity
- **getMethodologyDetails**: Review methodological approach, sampling, and analysis techniques
- **getRelatedEntities**: Find entities related to a specific entity by relationship type

## Example Prompts

### Starting a Session
```
Let's start a new qualitative research session for my Health Behavior Study project.
```

### Loading Research Context
```
Load the context for the Health Behavior Study project so I can see the current state of my analysis.
```

### Recording Session Results
```
I've just finished analyzing interview data for my Health Behavior Study. I identified two new themes related to social support, coded three new interviews, and wrote memos about emerging patterns in participant responses. The project is progressing well, and I'm beginning to reach theoretical saturation.
```

### Managing Research Knowledge
```
Create a new code called "Family Support" that's part of the "Social Support" code group in the Health Behavior Study project.
```

```
Add an observation to the "P001" participant that they have a strong family support network based on their interview responses.
```

## Usage

This MCP server enables qualitative researchers to:

- **Maintain Analytical Continuity**: Keep track of analysis progress across multiple research sessions
- **Develop Coding Frameworks**: Build, refine, and apply coding structures to qualitative data
- **Track Thematic Development**: Observe how themes emerge and evolve during analysis
- **Manage Rich Data Sources**: Organize and connect interview transcripts, field notes, and documents
- **Support Theoretical Development**: Document theoretical insights through the memo writing process
- **Prepare Research Findings**: Connect findings to supporting evidence and research questions
- **Enhance Methodological Rigor**: Document methodological decisions and analysis process

## Configuration

### Usage with Claude Desktop

Add this to your `claude_desktop_config.json`:

#### Install from GitHub and run with npx

```json
{
  "mcpServers": {
    "qualitativeresearch": {
      "command": "npx",
      "args": [
        "-y",
        "github:tejpalvirk/qualitativeresearch"
      ]
    }
  }
}
```

#### Install globally and run directly

First, install the package globally:

```bash
npm install -g github:tejpalvirk/qualitativeresearch
```

Then configure Claude Desktop:

```json
{
  "mcpServers": {
    "qualitativeresearch": {
      "command": "contextmanager-qualitativeresearch"
    }
  }
}
```

#### docker

```json
{
  "mcpServers": {
    "qualitativeresearch": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "mcp/qualitativeresearch"
      ]
    }
  }
}
```

## Building

### From Source

```bash
# Clone the repository
git clone https://github.com/tejpalvirk/contextmanager.git
cd contextmanager

# Install dependencies
npm install

# Build the server
npm run build

# Run the server
cd qualitativeresearch
node qualitativeresearch_index.js
```

### Docker:

```bash
docker build -t mcp/qualitativeresearch -f qualitativeresearch/Dockerfile .
```

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.