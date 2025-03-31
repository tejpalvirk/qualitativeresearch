#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from "zod";
import { readFileSync, existsSync } from "fs";

// Define memory file path using environment variable with fallback
const parentPath = path.dirname(fileURLToPath(import.meta.url));
const defaultMemoryPath = path.join(parentPath, 'memory.json');
const defaultSessionsPath = path.join(parentPath, 'sessions.json');

// Properly handle absolute and relative paths for MEMORY_FILE_PATH
const MEMORY_FILE_PATH = process.env.MEMORY_FILE_PATH
  ? path.isAbsolute(process.env.MEMORY_FILE_PATH)
    ? process.env.MEMORY_FILE_PATH  // Use absolute path as is
    : path.join(process.cwd(), process.env.MEMORY_FILE_PATH)  // Relative to current working directory
  : defaultMemoryPath;  // Default fallback

// Properly handle absolute and relative paths for SESSIONS_FILE_PATH
const SESSIONS_FILE_PATH = process.env.SESSIONS_FILE_PATH
  ? path.isAbsolute(process.env.SESSIONS_FILE_PATH)
    ? process.env.SESSIONS_FILE_PATH  // Use absolute path as is
    : path.join(process.cwd(), process.env.SESSIONS_FILE_PATH)  // Relative to current working directory
  : defaultSessionsPath;  // Default fallback

// Qualitative Research specific entity types
const VALID_ENTITY_TYPES = [
  'project',         // Overall research study
  'participant',     // Research subjects
  'interview',       // Formal conversation with participants
  'observation',     // Field notes from observational research
  'document',        // External materials being analyzed
  'code',            // Labels applied to data segments
  'codeGroup',       // Categories or families of related codes
  'memo',            // Researcher's analytical notes
  'theme',           // Emergent patterns across data
  'quote',           // Notable excerpts from data sources
  'literature',      // Academic sources
  'researchQuestion', // Formal questions guiding the study
  'finding',         // Results or conclusions
  'status',          // Status entity type
  'priority'         // Priority entity type
];

// Qualitative Research specific relation types
const VALID_RELATION_TYPES = [
  'participated_in',  // Links participants to interviews/observations
  'codes',            // Shows which codes apply to which data
  'contains',         // Hierarchical relationship (e.g., codegroup contains codes)
  'supports',         // Data supporting a theme or finding
  'contradicts',      // Data contradicting a theme or finding
  'answers',          // Data addressing a research question
  'cites',            // References to literature
  'followed_by',      // Temporal sequence
  'related_to',       // General connection
  'reflects_on',      // Memo reflecting on data/code/theme
  'compares',         // Comparative relationship
  'conducted_by',     // Person who conducted data collection
  'transcribed_by',   // Person who transcribed data
  'part_of',          // Entity is part of another entity
  'derived_from',     // Entity is derived from another entity
  'collected_on',     // Data collection date
  'analyzes',         // Analysis relationship
  'triangulates_with', // Triangulation between data sources
  'has_status',       // Entity has a specific status
  'has_priority',     // Entity has a specific priority
  'precedes'          // Entity comes before another entity in sequence
];

// Status values for different entity types in qualitative research
const STATUS_VALUES = {
  project: ['planning', 'data_collection', 'analysis', 'writing', 'complete'],
  interview: ['scheduled', 'conducted', 'transcribed', 'coded', 'analyzed'],
  observation: ['planned', 'conducted', 'documented', 'coded', 'analyzed'],
  code: ['initial', 'revised', 'final'],
  theme: ['emerging', 'developing', 'established'],
  finding: ['preliminary', 'draft', 'final']
};

// Define valid status values for all entity types
const VALID_STATUS_VALUES = [
  'planning', 'data_collection', 'analysis', 'writing', 'complete',
  'scheduled', 'conducted', 'transcribed', 'coded', 'analyzed',
  'planned', 'documented',
  'initial', 'revised', 'final',
  'emerging', 'developing', 'established',
  'preliminary', 'draft',
  'active', 'in_progress', 'not_started'
];

// Define valid priority values
const VALID_PRIORITY_VALUES = [
  'high', 'low'
];

// Basic validation functions
function validateEntityType(entityType: string): boolean {
  return VALID_ENTITY_TYPES.includes(entityType);
}

function validateRelationType(relationType: string): boolean {
  return VALID_RELATION_TYPES.includes(relationType);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Collect tool descriptions from text files
const toolDescriptions: Record<string, string> = {
  'startsession': '',
  'loadcontext': '',
  'deletecontext': '',
  'buildcontext': '',
  'advancedcontext': '',
  'endsession': '',
};
for (const tool of Object.keys(toolDescriptions)) {
  const descriptionFilePath = path.resolve(
    __dirname,
    `qualitativeresearch_${tool}.txt`
  );
  if (existsSync(descriptionFilePath)) {
    toolDescriptions[tool] = readFileSync(descriptionFilePath, 'utf-8');
  }
}

// Session management functions
async function loadSessionStates(): Promise<Map<string, any[]>> {
  try {
    const fileContent = await fs.readFile(SESSIONS_FILE_PATH, 'utf-8');
    const sessions = JSON.parse(fileContent);
    // Convert from object to Map
    const sessionsMap = new Map<string, any[]>();
    for (const [key, value] of Object.entries(sessions)) {
      sessionsMap.set(key, value as any[]);
    }
    return sessionsMap;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as any).code === "ENOENT") {
      return new Map<string, any[]>();
    }
    throw error;
  }
}

async function saveSessionStates(sessionsMap: Map<string, any[]>): Promise<void> {
  // Convert from Map to object
  const sessions: Record<string, any[]> = {};
  for (const [key, value] of sessionsMap.entries()) {
    sessions[key] = value;
  }
  await fs.writeFile(SESSIONS_FILE_PATH, JSON.stringify(sessions, null, 2), 'utf-8');
}

// Generate a unique session ID
function generateSessionId(): string {
  return `qual_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// We are storing our memory using entities, relations, and observations in a graph structure
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
class KnowledgeGraphManager {
  private async loadGraph(): Promise<KnowledgeGraph> {
    try {
      const fileContent = await fs.readFile(MEMORY_FILE_PATH, 'utf-8');
      return JSON.parse(fileContent);
    } catch (error) {
      // If the file doesn't exist, return an empty graph
      return {
        entities: [],
        relations: []
      };
    }
  }

  private async saveGraph(graph: KnowledgeGraph): Promise<void> {
    await fs.writeFile(MEMORY_FILE_PATH, JSON.stringify(graph, null, 2), 'utf-8');
  }

  // Initialize status and priority entities
  async initializeStatusAndPriority(): Promise<void> {
    const graph = await this.loadGraph();
    
    // Create status entities if they don't exist
    for (const statusValue of VALID_STATUS_VALUES) {
      const statusName = `status:${statusValue}`;
      if (!graph.entities.some(e => e.name === statusName && e.entityType === 'status')) {
        graph.entities.push({
          name: statusName,
          entityType: 'status',
          observations: [`A ${statusValue} status value`]
        });
      }
    }
    
    // Create priority entities if they don't exist
    for (const priorityValue of VALID_PRIORITY_VALUES) {
      const priorityName = `priority:${priorityValue}`;
      if (!graph.entities.some(e => e.name === priorityName && e.entityType === 'priority')) {
        graph.entities.push({
          name: priorityName,
          entityType: 'priority',
          observations: [`A ${priorityValue} priority value`]
        });
      }
    }
    
    await this.saveGraph(graph);
  }

  // Helper method to get status of an entity
  async getEntityStatus(entityName: string): Promise<string | null> {
    const graph = await this.loadGraph();
    
    // Find status relation for this entity
    const statusRelation = graph.relations.find(r => 
      r.from === entityName && 
      r.relationType === 'has_status'
    );
    
    if (statusRelation) {
      // Extract status value from the status entity name (status:value)
      return statusRelation.to.split(':')[1];
    }
    
    return null;
  }
  
  // Helper method to get priority of an entity
  async getEntityPriority(entityName: string): Promise<string | null> {
    const graph = await this.loadGraph();
    
    // Find priority relation for this entity
    const priorityRelation = graph.relations.find(r => 
      r.from === entityName && 
      r.relationType === 'has_priority'
    );
    
    if (priorityRelation) {
      // Extract priority value from the priority entity name (priority:value)
      return priorityRelation.to.split(':')[1];
    }
    
    return null;
  }
  
  // Helper method to set status of an entity
  async setEntityStatus(entityName: string, statusValue: string): Promise<void> {
    if (!VALID_STATUS_VALUES.includes(statusValue)) {
      throw new Error(`Invalid status value: ${statusValue}. Valid values are: ${VALID_STATUS_VALUES.join(', ')}`);
    }
    
    const graph = await this.loadGraph();
    
    // Remove any existing status relations for this entity
    graph.relations = graph.relations.filter(r => 
      !(r.from === entityName && r.relationType === 'has_status')
    );
    
    // Add new status relation
    graph.relations.push({
      from: entityName,
      to: `status:${statusValue}`,
      relationType: 'has_status'
    });
    
    await this.saveGraph(graph);
  }
  
  // Helper method to set priority of an entity
  async setEntityPriority(entityName: string, priorityValue: string): Promise<void> {
    if (!VALID_PRIORITY_VALUES.includes(priorityValue)) {
      throw new Error(`Invalid priority value: ${priorityValue}. Valid values are: ${VALID_PRIORITY_VALUES.join(', ')}`);
    }
    
    const graph = await this.loadGraph();
    
    // Remove any existing priority relations for this entity
    graph.relations = graph.relations.filter(r => 
      !(r.from === entityName && r.relationType === 'has_priority')
    );
    
    // Add new priority relation
    graph.relations.push({
      from: entityName,
      to: `priority:${priorityValue}`,
      relationType: 'has_priority'
    });
    
    await this.saveGraph(graph);
  }

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    const graph = await this.loadGraph();
    const existingEntityNames = new Set(graph.entities.map(e => e.name));
    
    // Validate entity types
    entities.forEach(entity => {
      if (!validateEntityType(entity.entityType)) {
        throw new Error(`Invalid entity type: ${entity.entityType}. Valid types are: ${VALID_ENTITY_TYPES.join(', ')}`);
      }
    });
    
    const newEntities = entities.filter(entity => !existingEntityNames.has(entity.name));
    graph.entities.push(...newEntities);
    
    await this.saveGraph(graph);
    return newEntities;
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    const graph = await this.loadGraph();
    const existingEntityNames = new Set(graph.entities.map(e => e.name));
    
    // Check that entities exist and validate relation types
    relations.forEach(relation => {
      if (!existingEntityNames.has(relation.from)) {
        throw new Error(`Entity '${relation.from}' not found`);
      }
      if (!existingEntityNames.has(relation.to)) {
        throw new Error(`Entity '${relation.to}' not found`);
      }
      if (!validateRelationType(relation.relationType)) {
        throw new Error(`Invalid relation type: ${relation.relationType}. Valid types are: ${VALID_RELATION_TYPES.join(', ')}`);
      }
    });
    
    // Filter out duplicate relations
    const existingRelations = new Set(
      graph.relations.map(r => `${r.from}:${r.to}:${r.relationType}`)
    );
    
    const newRelations = relations.filter(
      r => !existingRelations.has(`${r.from}:${r.to}:${r.relationType}`)
    );
    
    graph.relations.push(...newRelations);
    
    await this.saveGraph(graph);
    return newRelations;
  }

  async addObservations(observations: { entityName: string; contents: string[] }[]): Promise<{ entityName: string; addedObservations: string[] }[]> {
    const graph = await this.loadGraph();
    const results: { entityName: string; addedObservations: string[] }[] = [];
    
    for (const observation of observations) {
      const entity = graph.entities.find(e => e.name === observation.entityName);
      if (!entity) {
        throw new Error(`Entity '${observation.entityName}' not found`);
      }
      
      // Filter out duplicate observations
      const existingObservations = new Set(entity.observations);
      const newObservations = observation.contents.filter(o => !existingObservations.has(o));
      
      entity.observations.push(...newObservations);
      results.push({
        entityName: observation.entityName,
        addedObservations: newObservations
      });
    }
    
    await this.saveGraph(graph);
    return results;
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    const graph = await this.loadGraph();
    
    // Remove the entities
    graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
    
    // Remove relations that involve the deleted entities
    graph.relations = graph.relations.filter(
      r => !entityNames.includes(r.from) && !entityNames.includes(r.to)
    );
    
    await this.saveGraph(graph);
  }

  async deleteObservations(deletions: { entityName: string; observations: string[] }[]): Promise<void> {
    const graph = await this.loadGraph();
    
    for (const deletion of deletions) {
      const entity = graph.entities.find(e => e.name === deletion.entityName);
      if (entity) {
        // Remove the specified observations
        entity.observations = entity.observations.filter(
          o => !deletion.observations.includes(o)
        );
      }
    }
    
    await this.saveGraph(graph);
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    const graph = await this.loadGraph();
    
    // Remove specified relations
    graph.relations = graph.relations.filter(r => 
      !relations.some(toDelete => 
        r.from === toDelete.from && 
        r.to === toDelete.to && 
        r.relationType === toDelete.relationType
      )
    );
    
    await this.saveGraph(graph);
  }

  async readGraph(): Promise<KnowledgeGraph> {
    return this.loadGraph();
  }

  async searchNodes(query: string): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    
    // Split query into search terms
    const terms = query.toLowerCase().split(/\s+/);
    
    // Find matching entities
    const matchingEntityNames = new Set<string>();
    
    for (const entity of graph.entities) {
      // Check if all terms match
      const matchesAllTerms = terms.every(term => {
        // Check entity name
        if (entity.name.toLowerCase().includes(term)) {
          return true;
        }
        
        // Check entity type
        if (entity.entityType.toLowerCase().includes(term)) {
          return true;
        }
        
        // Check observations
        for (const observation of entity.observations) {
          if (observation.toLowerCase().includes(term)) {
            return true;
          }
        }
        
        return false;
      });
      
      if (matchesAllTerms) {
        matchingEntityNames.add(entity.name);
      }
    }
    
    // Find relations between matching entities
    const matchingRelations = graph.relations.filter(r => 
      matchingEntityNames.has(r.from) && matchingEntityNames.has(r.to)
    );
    
    // Return matching entities and their relations
    return {
      entities: graph.entities.filter(e => matchingEntityNames.has(e.name)),
      relations: matchingRelations
    };
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph();
    
    // Find the specified entities
    const entities = graph.entities.filter(e => names.includes(e.name));
    
    // Find relations between the specified entities
    const relations = graph.relations.filter(r => 
      names.includes(r.from) && names.includes(r.to)
    );
    
    return {
      entities,
      relations
    };
  }

  // Get project overview including research questions, methodology, participants, data sources
  async getProjectOverview(projectName: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the project
    const project = graph.entities.find(e => e.name === projectName && e.entityType === 'project');
    if (!project) {
      throw new Error(`Project '${projectName}' not found`);
    }
    
    // Find research questions
    const researchQuestions: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'part_of' && relation.to === projectName) {
        const question = graph.entities.find(
          e => e.name === relation.from && e.entityType === 'researchQuestion'
        );
        if (question) {
          researchQuestions.push(question);
        }
      }
    }
    
    // Find participants
    const participants: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'part_of' && relation.to === projectName) {
        const participant = graph.entities.find(
          e => e.name === relation.from && e.entityType === 'participant'
        );
        if (participant) {
          participants.push(participant);
        }
      }
    }
    
    // Find data sources (interviews, observations, documents)
    const interviews: Entity[] = [];
    const observations: Entity[] = [];
    const documents: Entity[] = [];
    
    for (const relation of graph.relations) {
      if (relation.relationType === 'part_of' && relation.to === projectName) {
        const entity = graph.entities.find(e => e.name === relation.from);
        
        if (entity) {
          if (entity.entityType === 'interview') {
            interviews.push(entity);
          } else if (entity.entityType === 'observation') {
            observations.push(entity);
          } else if (entity.entityType === 'document') {
            documents.push(entity);
          }
        }
      }
    }
    
    // Find findings
    const findings: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'part_of' && relation.to === projectName) {
        const finding = graph.entities.find(
          e => e.name === relation.from && e.entityType === 'finding'
        );
        if (finding) {
          findings.push(finding);
        }
      }
    }
    
    // Find themes
    const themes: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'part_of' && relation.to === projectName) {
        const theme = graph.entities.find(
          e => e.name === relation.from && e.entityType === 'theme'
        );
        if (theme) {
          themes.push(theme);
        }
      }
    }
    
    // Get methodology info from project observations
    const methodologyObs = project.observations.filter(
      o => o.toLowerCase().includes('method') || o.toLowerCase().includes('approach')
    );
    
    return {
      project,
      researchQuestions,
      methodology: methodologyObs,
      dataCollection: {
        participants: participants.length,
        interviews: interviews.length,
        observations: observations.length,
        documents: documents.length,
        participantsList: participants,
        interviewsList: interviews,
        observationsList: observations,
        documentsList: documents
      },
      analysis: {
        themes: themes.length,
        themesList: themes
      },
      findings
    };
  }

  // Get all data related to a specific participant
  async getParticipantProfile(participantName: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the participant
    const participant = graph.entities.find(e => e.name === participantName && e.entityType === 'participant');
    if (!participant) {
      throw new Error(`Participant '${participantName}' not found`);
    }
    
    // Find interviews with this participant
    const interviews: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'participated_in' && relation.from === participantName) {
        const interview = graph.entities.find(e => e.name === relation.to && e.entityType === 'interview');
        if (interview) {
          interviews.push(interview);
        }
      }
    }
    
    // Find observations including this participant
    const observations: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'participated_in' && relation.from === participantName) {
        const observation = graph.entities.find(e => e.name === relation.to && e.entityType === 'observation');
        if (observation) {
          observations.push(observation);
        }
      }
    }
    
    // Find quotes from this participant
    const quotes: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'contains' && relation.to === participantName) {
        const quote = graph.entities.find(e => e.name === relation.from && e.entityType === 'quote');
        if (quote) {
          quotes.push(quote);
        }
      }
    }
    
    // Find any memos about this participant
    const memos: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'reflects_on' && relation.to === participantName) {
        const memo = graph.entities.find(e => e.name === relation.from && e.entityType === 'memo');
        if (memo) {
          memos.push(memo);
        }
      }
    }
    
    // Extract demographic information from observations
    const demographicObs = participant.observations.filter(
      o => o.toLowerCase().includes('age') || 
           o.toLowerCase().includes('gender') || 
           o.toLowerCase().includes('occupation') ||
           o.toLowerCase().includes('education')
    );
    
    return {
      participant,
      demographics: demographicObs,
      interviews,
      observations,
      quotes,
      memos
    };
  }

  // Get themes with supporting codes and data
  async getThematicAnalysis(projectName: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the project
    const project = graph.entities.find(e => e.name === projectName && e.entityType === 'project');
    if (!project) {
      throw new Error(`Project '${projectName}' not found`);
    }
    
    // Find all themes related to this project
    const themes: Entity[] = [];
    
    for (const relation of graph.relations) {
      if (relation.relationType === 'part_of' && relation.to === projectName) {
        const theme = graph.entities.find(e => e.name === relation.from && e.entityType === 'theme');
        if (theme) {
          themes.push(theme);
        }
      }
    }
    
    // For each theme, find supporting data
    const thematicAnalysis = themes.map(theme => {
      // Find codes supporting this theme
      const supportingCodes: Entity[] = [];
      for (const relation of graph.relations) {
        if (relation.relationType === 'supports' && relation.to === theme.name) {
          const code = graph.entities.find(e => e.name === relation.from && e.entityType === 'code');
          if (code) {
            supportingCodes.push(code);
          }
        }
      }
      
      // For each code, find supporting quotes
      const codeData = supportingCodes.map(code => {
        const quotes: Entity[] = [];
        for (const relation of graph.relations) {
          if (relation.relationType === 'codes' && relation.from === code.name) {
            const quote = graph.entities.find(e => e.name === relation.to && e.entityType === 'quote');
            if (quote) {
              quotes.push(quote);
            }
          }
        }
        
        return {
          code,
          quotes
        };
      });
      
      // Find any memos reflecting on this theme
      const memos: Entity[] = [];
      for (const relation of graph.relations) {
        if (relation.relationType === 'reflects_on' && relation.to === theme.name) {
          const memo = graph.entities.find(e => e.name === relation.from && e.entityType === 'memo');
          if (memo) {
            memos.push(memo);
          }
        }
      }
      
      // Find status of the theme
      const statusObs = theme.observations.find(o => o.startsWith('Status:'));
      const status = statusObs ? statusObs.split(':')[1].trim() : 'unknown';
      
      return {
        theme,
        status,
        supportingData: codeData,
        codes: supportingCodes,
        memos
      };
    });
    
    return {
      project,
      themes: thematicAnalysis
    };
  }

  // Get all data segments tagged with a specific code
  async getCodedData(codeName: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the code
    const code = graph.entities.find(e => e.name === codeName && e.entityType === 'code');
    if (!code) {
      throw new Error(`Code '${codeName}' not found`);
    }
    
    // Find which code group this code belongs to, if any
    const codeGroups: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'contains' && relation.to === codeName) {
        const codeGroup = graph.entities.find(e => e.name === relation.from && e.entityType === 'codeGroup');
        if (codeGroup) {
          codeGroups.push(codeGroup);
        }
      }
    }
    
    // Find all quotes tagged with this code
    const quotes: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'codes' && relation.from === codeName) {
        const quote = graph.entities.find(e => e.name === relation.to && e.entityType === 'quote');
        if (quote) {
          quotes.push(quote);
        }
      }
    }
    
    // Find which sources (interviews, observations, documents) these quotes come from
    const sources = new Map<string, Entity>();
    
    for (const quote of quotes) {
      for (const relation of graph.relations) {
        if (relation.relationType === 'contains' && relation.from !== codeName && relation.to === quote.name) {
          const source = graph.entities.find(e => e.name === relation.from);
          if (source) {
            sources.set(source.name, source);
          }
        }
      }
    }
    
    // Find themes this code supports
    const themes: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'supports' && relation.from === codeName) {
        const theme = graph.entities.find(e => e.name === relation.to && e.entityType === 'theme');
        if (theme) {
          themes.push(theme);
        }
      }
    }
    
    // Find any memos reflecting on this code
    const memos: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'reflects_on' && relation.to === codeName) {
        const memo = graph.entities.find(e => e.name === relation.from && e.entityType === 'memo');
        if (memo) {
          memos.push(memo);
        }
      }
    }
    
    return {
      code,
      codeGroups,
      quotes,
      sourceCount: sources.size,
      sources: Array.from(sources.values()),
      themes,
      memos
    };
  }

  // Shows data organized by research questions with findings
  async getResearchQuestionAnalysis(projectName: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the project
    const project = graph.entities.find(e => e.name === projectName && e.entityType === 'project');
    if (!project) {
      throw new Error(`Project '${projectName}' not found`);
    }
    
    // Find all research questions for this project
    const researchQuestions: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'part_of' && relation.to === projectName) {
        const question = graph.entities.find(e => e.name === relation.from && e.entityType === 'researchQuestion');
        if (question) {
          researchQuestions.push(question);
        }
      }
    }
    
    // For each research question, find related data
    const questionAnalysis = researchQuestions.map(question => {
      // Find findings that answer this question
      const findings: Entity[] = [];
      for (const relation of graph.relations) {
        if (relation.relationType === 'answers' && relation.to === question.name) {
          const finding = graph.entities.find(e => e.name === relation.from && e.entityType === 'finding');
          if (finding) {
            findings.push(finding);
          }
        }
      }
      
      // Find themes related to this question
      const themes: Entity[] = [];
      for (const relation of graph.relations) {
        if (relation.relationType === 'answers' && relation.to === question.name) {
          const theme = graph.entities.find(e => e.name === relation.from && e.entityType === 'theme');
          if (theme) {
            themes.push(theme);
          }
        }
      }
      
      // Find data directly addressing this question
      const quotes: Entity[] = [];
      for (const relation of graph.relations) {
        if (relation.relationType === 'answers' && relation.to === question.name) {
          const quote = graph.entities.find(e => e.name === relation.from && e.entityType === 'quote');
          if (quote) {
            quotes.push(quote);
          }
        }
      }
      
      return {
        question,
        findings,
        themes,
        quotes
      };
    });
    
    return {
      project,
      researchQuestions: questionAnalysis
    };
  }

  // Returns data in temporal sequence
  async getChronologicalData(projectName: string, dataType?: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the project
    const project = graph.entities.find(e => e.name === projectName && e.entityType === 'project');
    if (!project) {
      throw new Error(`Project '${projectName}' not found`);
    }
    
    // Find all data collection entities for this project
    let dataEntities: Entity[] = [];
    
    for (const relation of graph.relations) {
      if (relation.relationType === 'part_of' && relation.to === projectName) {
        let entity;
        
        // Filter by data type if specified
        if (dataType) {
          entity = graph.entities.find(
            e => e.name === relation.from && e.entityType === dataType
          );
        } else {
          entity = graph.entities.find(
            e => e.name === relation.from && 
               (e.entityType === 'interview' || 
                e.entityType === 'observation' || 
                e.entityType === 'document')
          );
        }
        
        if (entity) {
          dataEntities.push(entity);
        }
      }
    }
    
    // Extract date information for each entity
    const dataWithDates = dataEntities.map(entity => {
      const dateObs = entity.observations.find(o => 
        o.startsWith('Date:') || o.startsWith('Collected on:') || o.startsWith('Created:')
      );
      
      let date = new Date(0);
      if (dateObs) {
        // Extract date string and try to parse it
        const dateString = dateObs.split(':')[1].trim();
        const parsedDate = new Date(dateString);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate;
        }
      }
      
      return {
        entity,
        date
      };
    });
    
    // Sort by date
    dataWithDates.sort((a, b) => a.date.getTime() - b.date.getTime());
    
    // Create a timeline of data
    const timeline = dataWithDates.map(item => {
      // For each entity, find related quotes
      const quotes: Entity[] = [];
      for (const relation of graph.relations) {
        if (relation.relationType === 'contains' && relation.from === item.entity.name) {
          const quote = graph.entities.find(e => e.name === relation.to && e.entityType === 'quote');
          if (quote) {
            quotes.push(quote);
          }
        }
      }
      
      return {
        date: item.date,
        entity: item.entity,
        quotes
      };
    });
    
    return {
      project,
      timeline
    };
  }

  // Finds where multiple codes appear together
  async getCodeCooccurrence(codeName: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the code
    const code = graph.entities.find(e => e.name === codeName && e.entityType === 'code');
    if (!code) {
      throw new Error(`Code '${codeName}' not found`);
    }
    
    // Find all quotes tagged with this code
    const quotes: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'codes' && relation.from === codeName) {
        const quote = graph.entities.find(e => e.name === relation.to && e.entityType === 'quote');
        if (quote) {
          quotes.push(quote);
        }
      }
    }
    
    // For each quote, find other codes that also tag it
    const codeOccurrences = new Map<string, { code: Entity; count: number; quotes: Entity[] }>();
    
    for (const quote of quotes) {
      for (const relation of graph.relations) {
        if (relation.relationType === 'codes' && relation.from !== codeName && relation.to === quote.name) {
          const otherCode = graph.entities.find(e => e.name === relation.from && e.entityType === 'code');
          if (otherCode) {
            if (codeOccurrences.has(otherCode.name)) {
              const occurrence = codeOccurrences.get(otherCode.name)!;
              occurrence.count++;
              occurrence.quotes.push(quote);
            } else {
              codeOccurrences.set(otherCode.name, {
                code: otherCode,
                count: 1,
                quotes: [quote]
              });
            }
          }
        }
      }
    }
    
    // Sort codes by co-occurrence frequency
    const cooccurringCodes = Array.from(codeOccurrences.values())
      .sort((a, b) => b.count - a.count);
    
    return {
      code,
      quotesCount: quotes.length,
      cooccurringCodes
    };
  }

  // Gets all memos related to a specific entity
  async getMemosByFocus(entityName: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the entity
    const entity = graph.entities.find(e => e.name === entityName);
    if (!entity) {
      throw new Error(`Entity '${entityName}' not found`);
    }
    
    // Find all memos reflecting on this entity
    const memos: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'reflects_on' && relation.to === entityName) {
        const memo = graph.entities.find(e => e.name === relation.from && e.entityType === 'memo');
        if (memo) {
          memos.push(memo);
        }
      }
    }
    
    // Sort memos by date if possible
    const memosWithDates = memos.map(memo => {
      const dateObs = memo.observations.find(o => o.startsWith('Date:') || o.startsWith('Created:'));
      
      let date = new Date(0);
      if (dateObs) {
        const dateString = dateObs.split(':')[1].trim();
        const parsedDate = new Date(dateString);
        if (!isNaN(parsedDate.getTime())) {
          date = parsedDate;
        }
      }
      
      return {
        memo,
        date
      };
    });
    
    // Sort by date, most recent first
    memosWithDates.sort((a, b) => b.date.getTime() - a.date.getTime());
    
    return {
      entity,
      memos: memosWithDates.map(m => m.memo)
    };
  }

  // Returns information about methods, sampling, analysis approach
  async getMethodologyDetails(projectName: string): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the project
    const project = graph.entities.find(e => e.name === projectName && e.entityType === 'project');
    if (!project) {
      throw new Error(`Project '${projectName}' not found`);
    }
    
    // Extract methodology information from project observations
    const methodologyObs = project.observations.filter(o => 
      o.toLowerCase().includes('method') || 
      o.toLowerCase().includes('approach') || 
      o.toLowerCase().includes('sampling') || 
      o.toLowerCase().includes('analysis') ||
      o.toLowerCase().includes('validity') ||
      o.toLowerCase().includes('reliability')
    );
    
    // Find methodology-related memos
    const memos: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'reflects_on' && relation.to === projectName) {
        const memo = graph.entities.find(e => e.name === relation.from && e.entityType === 'memo');
        if (memo && memo.observations.some(o => 
          o.toLowerCase().includes('method') || 
          o.toLowerCase().includes('approach') || 
          o.toLowerCase().includes('sampling') || 
          o.toLowerCase().includes('analysis')
        )) {
          memos.push(memo);
        }
      }
    }
    
    // Calculate data collection statistics
    // 1. Get all interviews
    const interviews: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'part_of' && relation.to === projectName) {
        const interview = graph.entities.find(e => e.name === relation.from && e.entityType === 'interview');
        if (interview) {
          interviews.push(interview);
        }
      }
    }
    
    // 2. Get all observations
    const observations: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'part_of' && relation.to === projectName) {
        const observation = graph.entities.find(e => e.name === relation.from && e.entityType === 'observation');
        if (observation) {
          observations.push(observation);
        }
      }
    }
    
    // 3. Get all documents
    const documents: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'part_of' && relation.to === projectName) {
        const document = graph.entities.find(e => e.name === relation.from && e.entityType === 'document');
        if (document) {
          documents.push(document);
        }
      }
    }
    
    // 4. Get all participants
    const participants: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'part_of' && relation.to === projectName) {
        const participant = graph.entities.find(e => e.name === relation.from && e.entityType === 'participant');
        if (participant) {
          participants.push(participant);
        }
      }
    }
    
    // Find literature cited in this project
    const literature: Entity[] = [];
    for (const relation of graph.relations) {
      if (relation.relationType === 'cites' && relation.from === projectName) {
        const source = graph.entities.find(e => e.name === relation.to && e.entityType === 'literature');
        if (source) {
          literature.push(source);
        }
      }
    }
    
    return {
      project,
      methodology: methodologyObs,
      dataCollection: {
        participants: participants.length,
        interviews: interviews.length,
        observations: observations.length,
        documents: documents.length
      },
      memos,
      literature
    };
  }

  // First, let's add the missing getRelatedEntities method to the KnowledgeGraphManager class
  // Add this before the async main() function

  async getRelatedEntities(entityName: string, relationTypes?: string[]): Promise<any> {
    const graph = await this.loadGraph();
    
    // Find the entity
    const entity = graph.entities.find(e => e.name === entityName);
    if (!entity) {
      throw new Error(`Entity '${entityName}' not found`);
    }
    
    // Find all relations involving this entity
    let relevantRelations = graph.relations.filter(r => r.from === entityName || r.to === entityName);
    
    // Filter by relation types if specified
    if (relationTypes && relationTypes.length > 0) {
      relevantRelations = relevantRelations.filter(r => relationTypes.includes(r.relationType));
    }
    
    // Get all related entities grouped by relation type
    const related: Record<string, Entity[]> = {};
    
    for (const relation of relevantRelations) {
      const relationType = relation.relationType;
      if (!related[relationType]) {
        related[relationType] = [];
      }
      
      if (relation.from === entityName) {
        const target = graph.entities.find(e => e.name === relation.to);
        if (target) {
          related[relationType].push(target);
        }
      } else {
        const source = graph.entities.find(e => e.name === relation.from);
        if (source) {
          related[relationType].push(source);
        }
      }
    }
    
    return {
      entity,
      related
    };
  }
}

// Main function to set up the MCP server
async function main() {
  try {
    const knowledgeGraphManager = new KnowledgeGraphManager();
    
    // Initialize status and priority entities
    await knowledgeGraphManager.initializeStatusAndPriority();
    
    // Create the MCP server with a name and version
    const server = new McpServer({
      name: "Context Manager",
      version: "1.0.0"
    });
    
    // Define a resource that exposes the entire graph
    server.resource(
      "graph",
      "graph://researcher/qualitative",
      async (uri) => ({
        contents: [{
          uri: uri.href,
          text: JSON.stringify(await knowledgeGraphManager.readGraph(), null, 2)
        }]
      })
    );
    
    // Define tools using zod for parameter validation

    /**
     * Load context for a specific entity
     */
    server.tool(
      "loadcontext",
      toolDescriptions["loadcontext"],
      {
        entityName: z.string(),
        entityType: z.string().optional(),
        sessionId: z.string().optional() // Optional to maintain backward compatibility
      },
      async ({ entityName, entityType = "project", sessionId }) => {
        try {
          // Validate session if ID is provided
          if (sessionId) {
            const sessionStates = await loadSessionStates();
            if (!sessionStates.has(sessionId)) {
              console.warn(`Warning: Session ${sessionId} not found, but proceeding with context load`);
              // Initialize it anyway for more robustness
              sessionStates.set(sessionId, []);
              await saveSessionStates(sessionStates);
            }
            
            // Track that this entity was loaded in this session
            const sessionState = sessionStates.get(sessionId) || [];
            const loadEvent = {
              type: 'context_loaded',
              timestamp: new Date().toISOString(),
              entityName,
              entityType
            };
            sessionState.push(loadEvent);
            sessionStates.set(sessionId, sessionState);
            await saveSessionStates(sessionStates);
          }
          
          // Get the entity
          // Changed from using 'name:' prefix to directly searching by the entity name
          const entityGraph = await knowledgeGraphManager.searchNodes(entityName);
          if (entityGraph.entities.length === 0) {
            throw new Error(`Entity ${entityName} not found`);
          }
          
          // Find the exact entity by name (case-sensitive match)
          const entity = entityGraph.entities.find(e => e.name === entityName);
          if (!entity) {
            throw new Error(`Entity ${entityName} not found`);
          }
          
          // Different context loading based on entity type
          let contextMessage = "";
          
          if (entityType === "project") {
            // Get project overview
            const projectOverview = await knowledgeGraphManager.getProjectOverview(entityName);
            
            // Get thematic analysis
            let thematicAnalysis;
            try {
              thematicAnalysis = await knowledgeGraphManager.getThematicAnalysis(entityName);
            } catch (error) {
              thematicAnalysis = { themes: [] };
            }
            
            // Get research question analysis
            let researchQuestions;
            try {
              researchQuestions = await knowledgeGraphManager.getResearchQuestionAnalysis(entityName);
            } catch (error) {
              researchQuestions = { researchQuestions: [] };
            }
            
            // Get methodology details
            let methodology;
            try {
              methodology = await knowledgeGraphManager.getMethodologyDetails(entityName);
            } catch (error) {
              methodology = { methodology: [] };
            }
            
            // Get status and priority using the relation-based approach
            const status = await knowledgeGraphManager.getEntityStatus(entityName) || "Unknown";
            const priority = await knowledgeGraphManager.getEntityPriority(entityName);
            const priorityText = priority ? `- **Priority**: ${priority}` : "";
            
            // Format observations
            const observationsList = entity.observations.length > 0 
              ? entity.observations.map(obs => `- ${obs}`).join("\n")
              : "No observations";
            
            // Extract methodology information
            const methodologyText = methodology.methodology?.map((m: string) => `- ${m}`).join("\n") || "No methodology details available";
            
            // Extract research questions
            const questionsText = researchQuestions.researchQuestions?.map((q: any) => {
              const findings = q.findings?.map((f: Entity) => `  - ${f.name}`).join("\n") || "  - No findings yet";
              return `- **${q.question.name}**\n${findings}`;
            }).join("\n") || "No research questions found";
            
            // Format data collection stats
            const participantCount = projectOverview.dataCollection?.participants || 0;
            const interviewCount = projectOverview.dataCollection?.interviews || 0;
            const observationCount = projectOverview.dataCollection?.observations || 0;
            const documentCount = projectOverview.dataCollection?.documents || 0;
            
            // Format theme analysis
            const themesText = thematicAnalysis.themes?.map(async (t: any) => {
              const codeCount = t.supportingData?.length || 0;
              const themeStatus = await knowledgeGraphManager.getEntityStatus(t.theme.name) || "unknown";
              return `- **${t.theme.name}** (Status: ${themeStatus}): ${codeCount} codes`;
            });
            
            const resolvedThemesText = themesText ? 
              await Promise.all(themesText).then(texts => texts.join("\n")) : 
              "No themes identified yet";
            
            // Get recent data collection - without date references
            const recentInterviews = projectOverview.dataCollection?.interviewsList?.slice(0, 5).map(async (i: Entity) => {
              const participant = i.observations.find(o => o.startsWith("participant:"))?.substring(12) || "Unknown";
              const interviewStatus = await knowledgeGraphManager.getEntityStatus(i.name) || "unknown";
              return `- **${i.name}** with ${participant} (Status: ${interviewStatus})`;
            });
            
            const resolvedInterviewsText = recentInterviews ? 
              await Promise.all(recentInterviews).then(texts => texts.join("\n")) : 
              "No recent interviews";
            
            // Get findings with status from relations
            const findingsText = projectOverview.findings?.map(async (f: Entity) => {
              const findingStatus = await knowledgeGraphManager.getEntityStatus(f.name) || "preliminary";
              const findingObs = f.observations.length > 0 ? f.observations[0] : "No description";
              return `- **${f.name}** (Status: ${findingStatus}): ${findingObs}`;
            });
            
            const resolvedFindingsText = findingsText ? 
              await Promise.all(findingsText).then(texts => texts.join("\n")) : 
              "No findings recorded yet";
            
            contextMessage = `# Qualitative Research Project Context: ${entityName}

## Project Details
- **Status**: ${status}
${priorityText}

## Observations
${observationsList}

## Research Design
${methodologyText}

## Research Questions
${questionsText}

## Data Collection Stats
- **Participants**: ${participantCount}
- **Interviews**: ${interviewCount}
- **Observations**: ${observationCount}
- **Documents**: ${documentCount}

## Recent Interviews
${resolvedInterviewsText}

## Analysis Progress
### Themes
${resolvedThemesText}

## Findings
${resolvedFindingsText}`;
          } 
          else if (entityType === "participant") {
            // Get participant profile
            const participantProfile = await knowledgeGraphManager.getParticipantProfile(entityName);
            
            // Get status and priority using the relation-based approach
            const status = await knowledgeGraphManager.getEntityStatus(entityName) || "Unknown";
            const priority = await knowledgeGraphManager.getEntityPriority(entityName);
            const priorityText = priority ? `- **Priority**: ${priority}` : "";
            
            // Format observations
            const observationsList = entity.observations.length > 0 
              ? entity.observations.map(obs => `- ${obs}`).join("\n")
              : "No observations";
            
            // Format demographics without relying on patterns
            const demographics = participantProfile.demographics?.map((d: string) => `- ${d}`).join("\n") || "No demographic information available";
            
            // Format interviews with status from relations
            const interviewsText = participantProfile.interviews?.map(async (i: Entity) => {
              const interviewStatus = await knowledgeGraphManager.getEntityStatus(i.name) || "unknown";
              return `- **${i.name}** (Status: ${interviewStatus})`;
            });
            
            const resolvedInterviewsText = interviewsText ? 
              await Promise.all(interviewsText).then(texts => texts.join("\n")) : 
              "No interviews recorded";
            
            // Format observations with status from relations
            const observationsText = participantProfile.observations?.map(async (o: Entity) => {
              const observationStatus = await knowledgeGraphManager.getEntityStatus(o.name) || "unknown";
              return `- **${o.name}** (Status: ${observationStatus})`;
            });
            
            const resolvedObservationsText = observationsText ? 
              await Promise.all(observationsText).then(texts => texts.join("\n")) : 
              "No observations recorded";
            
            // Format quotes
            const quotesText = participantProfile.quotes?.map((q: Entity) => {
              // Show the full quote
              const quote = q.observations.find(o => !o.startsWith("source:") && !o.startsWith("context:"));
              const source = q.observations.find(o => o.startsWith("source:"))?.substring(7) || "Unknown source";
              return `- "${quote || "No text available"}" (Source: ${source})`;
            }).join("\n") || "No quotes recorded";
            
            // Format memos
            const memosText = participantProfile.memos?.map(async (m: Entity) => {
              const memoStatus = await knowledgeGraphManager.getEntityStatus(m.name) || "unknown";
              const topic = m.observations.find(o => o.startsWith("topic:"))?.substring(6) || "Untitled";
              return `- **${topic}** (Status: ${memoStatus})`;
            });
            
            const resolvedMemosText = memosText ? 
              await Promise.all(memosText).then(texts => texts.join("\n")) : 
              "No memos about this participant";
            
            contextMessage = `# Participant Context: ${entityName}

## Status and Priority
- **Status**: ${status}
${priorityText}

## Observations
${observationsList}

## Demographics
${demographics}

## Interviews
${resolvedInterviewsText}

## Observations
${resolvedObservationsText}

## Quotes
${quotesText}

## Research Memos
${resolvedMemosText}`;
          }
          else if (entityType === "interview") {
            // Find which project this interview belongs to
            let projectName = 'Unknown project';
            
            for (const relation of entityGraph.relations) {
              if (relation.relationType === 'part_of' && relation.from === entityName) {
                const project = entityGraph.entities.find(e => e.name === relation.to && e.entityType === 'project');
                if (project) {
                  projectName = project.name;
                  break;
                }
              }
            }
            
            // Get status and priority using the relation-based approach
            const status = await knowledgeGraphManager.getEntityStatus(entityName) || "Unknown";
            const priority = await knowledgeGraphManager.getEntityPriority(entityName);
            const priorityText = priority ? `- **Priority**: ${priority}` : "";
            
            // Format observations
            const observationsList = entity.observations.length > 0 
              ? entity.observations.map(obs => `- ${obs}`).join("\n")
              : "No observations";
            
            // Get interview details without parsing date
            const participant = entity.observations.find(o => o.startsWith("participant:"))?.substring(12) || "Unknown";
            
            // Find codes applied to this interview and include their status
            const codesWithStatus = [];
            
            for (const relation of entityGraph.relations) {
              if (relation.relationType === 'codes' && relation.to === entityName) {
                const code = entityGraph.entities.find(e => e.name === relation.from && e.entityType === 'code');
                if (code) {
                  const codeStatus = await knowledgeGraphManager.getEntityStatus(code.name) || "unknown";
                  codesWithStatus.push({
                    code,
                    status: codeStatus
                  });
                }
              }
            }
            
            const codesText = codesWithStatus.map(c => 
              `- **${c.code.name}** (Status: ${c.status}): ${c.code.observations[0] || "No description"}`
            ).join("\n") || "No codes applied yet";
            
            // Find quotes from this interview
            const quotes = [];
            for (const relation of entityGraph.relations) {
              if (relation.relationType === 'contains' && relation.from === entityName) {
                const quote = entityGraph.entities.find(e => e.name === relation.to && e.entityType === 'quote');
                if (quote) {
                  quotes.push(quote);
                }
              }
            }
            
            const quotesText = quotes.map(q => {
              // Get the full quote text
              const quoteText = q.observations.find(o => !o.startsWith("context:") && !o.startsWith("speaker:")) || "No text";
              return `- "${quoteText}"`;
            }).join("\n") || "No notable quotes recorded";
            
            contextMessage = `# Interview Context: ${entityName}

## Overview
- **Project**: ${projectName}
- **Participant**: ${participant}
- **Status**: ${status}
${priorityText}

## Observations
${observationsList}

## Applied Codes
${codesText}

## Notable Quotes
${quotesText}`;
          }
          else if (entityType === "code") {
            // Get coded data for this code
            const codedData = await knowledgeGraphManager.getCodedData(entityName);
            
            // Format code context
            const definition = entity.observations.find(o => !o.startsWith("status:") && !o.startsWith("created:"));
            const created = entity.observations.find(o => o.startsWith("created:"))?.substring(8) || "Unknown";
            const status = entity.observations.find(o => o.startsWith("status:"))?.substring(7) || "active";
            
            // Format code groups
            const codeGroupsText = codedData.codeGroups?.map((group: Entity) => {
              const description = group.observations.find(o => !o.startsWith("created:"));
              return `- **${group.name}**: ${description || "No description"}`;
            }).join("\n") || "Not part of any code groups";
            
            // Format quotes
            const quotesText = codedData.quotes?.map((quote: Entity) => {
              const source = quote.observations.find(o => o.startsWith("source:"))?.substring(7) || "Unknown source";
              const text = quote.observations.find(o => !o.startsWith("source:") && !o.startsWith("context:"));
              return `- "${text || "No text"}" (Source: ${source})`;
            }).join("\n") || "No quotes tagged with this code";
            
            // Format sources
            const sourcesText = codedData.sources?.map((source: Entity) => {
              return `- **${source.name}** (${source.entityType})`;
            }).join("\n") || "No sources found";
            
            // Format themes
            const themesText = codedData.themes?.map((theme: Entity) => {
              const description = theme.observations.find(o => !o.startsWith("status:") && !o.startsWith("created:"));
              return `- **${theme.name}**: ${description || "No description"}`;
            }).join("\n") || "Not associated with any themes";
            
            // Get co-occurrence data
            let cooccurrenceData;
            try {
              cooccurrenceData = await knowledgeGraphManager.getCodeCooccurrence(entityName);
              
              // Format co-occurrence
              const cooccurrenceText = cooccurrenceData.cooccurringCodes?.map((c: any) => {
                return `- **${c.code.name}** (${c.count} co-occurrences)`;
              }).slice(0, 5).join("\n") || "No code co-occurrence data";
              
              contextMessage = `# Code Context: ${entityName}

## Code Details
- **Definition**: ${definition || "No definition provided"}
- **Created**: ${created}
- **Status**: ${status}
- **Items Coded**: ${codedData.quotes?.length || 0}

## Part of Code Groups
${codeGroupsText}

## Supporting Themes
${themesText}

## Top Co-occurring Codes
${cooccurrenceText}

## Example Quotes
${quotesText}

## Used in These Sources
${sourcesText}`;
            } catch (error) {
              contextMessage = `# Code Context: ${entityName}

## Code Details
- **Definition**: ${definition || "No definition provided"}
- **Created**: ${created}
- **Status**: ${status}
- **Items Coded**: ${codedData.quotes?.length || 0}

## Part of Code Groups
${codeGroupsText}

## Supporting Themes
${themesText}

## Example Quotes
${quotesText}

## Used in These Sources
${sourcesText}`;
            }
          }
          else if (entityType === "theme") {
            // Get thematic analysis data
            let projectName = "";
            
            // Find which project this theme belongs to
            for (const relation of entityGraph.relations) {
              if (relation.relationType === 'part_of' && relation.from === entityName) {
                const project = entityGraph.entities.find(e => e.name === relation.to && e.entityType === 'project');
                if (project) {
                  projectName = project.name;
                  break;
                }
              }
            }
            
            let thematicAnalysis;
            try {
              thematicAnalysis = await knowledgeGraphManager.getThematicAnalysis(projectName);
              
              // Find this theme in the analysis
              const themeAnalysis = thematicAnalysis.themes?.find((t: any) => t.theme.name === entityName);
              
              if (themeAnalysis) {
                const description = entity.observations.find(o => !o.startsWith("created:") && !o.startsWith("status:"));
                const status = entity.observations.find(o => o.startsWith("status:"))?.substring(7) || "emerging";
                const created = entity.observations.find(o => o.startsWith("created:"))?.substring(8) || "Unknown";
                
                // Format codes
                const codesText = themeAnalysis.codes?.map((code: Entity) => {
                  const definition = code.observations.find(o => !o.startsWith("status:") && !o.startsWith("created:"));
                  return `- **${code.name}**: ${definition || "No definition"}`;
                }).join("\n") || "No supporting codes";
                
                // Format supporting quotes
                const quotesText = themeAnalysis.supportingData?.flatMap((codeData: any) => 
                  codeData.quotes.map((quote: Entity) => {
                    const text = quote.observations.find(o => !o.startsWith("source:") && !o.startsWith("context:"));
                    return `- "${text || "No text"}" [Code: ${codeData.code.name}]`;
                  })
                ).slice(0, 10).join("\n") || "No supporting quotes";
                
                // Format memos
                const memosText = themeAnalysis.memos?.map((memo: Entity) => {
                  const date = memo.observations.find(o => o.startsWith("date:"))?.substring(5) || "Unknown date";
                  const topic = memo.observations.find(o => o.startsWith("topic:"))?.substring(6) || "Untitled";
                  const content = memo.observations.find(o => !o.startsWith("date:") && !o.startsWith("topic:"));
                  return `- **${topic}** (${date}): ${content ? (content.length > 100 ? content.substring(0, 100) + "..." : content) : "No content"}`;
                }).join("\n") || "No analytical memos about this theme";
                
                contextMessage = `# Theme Context: ${entityName}

## Theme Details
- **Description**: ${description || "No description provided"}
- **Status**: ${status}
- **Created**: ${created}
- **Project**: ${projectName || "Not associated with a specific project"}

## Supporting Codes
${codesText}

## Example Supporting Quotes
${quotesText}

## Analytical Memos
${memosText}`;
              } else {
                const description = entity.observations.find(o => !o.startsWith("created:") && !o.startsWith("status:"));
                const status = entity.observations.find(o => o.startsWith("status:"))?.substring(7) || "emerging";
                
                contextMessage = `# Theme Context: ${entityName}

## Theme Details
- **Description**: ${description || "No description provided"}
- **Status**: ${status}
- **Project**: ${projectName || "Not associated with a specific project"}

No detailed analysis available for this theme.`;
              }
            } catch (error) {
              const description = entity.observations.find(o => !o.startsWith("created:") && !o.startsWith("status:"));
              const status = entity.observations.find(o => o.startsWith("status:"))?.substring(7) || "emerging";
              
              contextMessage = `# Theme Context: ${entityName}

## Theme Details
- **Description**: ${description || "No description provided"}
- **Status**: ${status}
- **Project**: ${projectName || "Not associated with a specific project"}

No detailed analysis available for this theme.`;
            }
          }
          else if (entityType === "memo") {
            // Get memo details
            const topic = entity.observations.find(o => o.startsWith("topic:"))?.substring(6) || "Untitled";
            const date = entity.observations.find(o => o.startsWith("date:"))?.substring(5) || "Unknown date";
            const content = entity.observations.find(o => !o.startsWith("topic:") && !o.startsWith("date:"));
            
            // Find what this memo reflects on
            const relatedEntities: Entity[] = [];
            for (const relation of entityGraph.relations) {
              if (relation.relationType === 'reflects_on' && relation.from === entityName) {
                const relatedEntity = entityGraph.entities.find(e => e.name === relation.to);
                if (relatedEntity) {
                  relatedEntities.push(relatedEntity);
                }
              }
            }
            
            // Find which project this memo belongs to
            let projectName = 'Unknown project';
            for (const relation of entityGraph.relations) {
              if (relation.relationType === 'part_of' && relation.from === entityName) {
                const project = entityGraph.entities.find(e => e.name === relation.to && e.entityType === 'project');
                if (project) {
                  projectName = project.name;
                  break;
                }
              }
            }
            
            // Format related entities
            const relatedText = relatedEntities.map((e: Entity) => `- **${e.name}** (${e.entityType})`).join("\n") || "Not specifically linked to any entities";
            
            contextMessage = `# Memo Context: ${entityName}

## Memo Details
- **Topic**: ${topic}
- **Date**: ${date}
- **Project**: ${projectName}

## Content
${content || "No content available"}

## Related Entities
${relatedText}`;
          }
          else if (entityType === "researchQuestion") {
            // Find which project this research question belongs to
            let projectName = 'Unknown project';
            for (const relation of entityGraph.relations) {
              if (relation.relationType === 'part_of' && relation.from === entityName) {
                const project = entityGraph.entities.find(e => e.name === relation.to && e.entityType === 'project');
                if (project) {
                  projectName = project.name;
                  break;
                }
              }
            }
            
            // Get research question analysis
            let analysisData;
            try {
              analysisData = await knowledgeGraphManager.getResearchQuestionAnalysis(projectName);
              
              // Find this question in the analysis
              const questionAnalysis = analysisData.researchQuestions?.find((q: any) => q.question.name === entityName);
              
              if (questionAnalysis) {
                // Format findings
                const findingsText = questionAnalysis.findings?.map((finding: Entity) => {
                  const status = finding.observations.find(o => o.startsWith("status:"))?.substring(7) || "preliminary";
                  const description = finding.observations.find(o => !o.startsWith("status:") && !o.startsWith("created:"));
                  return `- **${finding.name}** (${status}): ${description || "No description"}`;
                }).join("\n") || "No findings recorded yet";
                
                // Format themes
                const themesText = questionAnalysis.themes?.map((theme: Entity) => {
                  const description = theme.observations.find(o => !o.startsWith("status:") && !o.startsWith("created:"));
                  return `- **${theme.name}**: ${description || "No description"}`;
                }).join("\n") || "No themes associated with this question";
                
                // Format quotes
                const quotesText = questionAnalysis.quotes?.map((quote: Entity) => {
                  const source = quote.observations.find(o => o.startsWith("source:"))?.substring(7) || "Unknown source";
                  const text = quote.observations.find(o => !o.startsWith("source:") && !o.startsWith("context:"));
                  return `- "${text || "No text"}" (Source: ${source})`;
                }).slice(0, 5).join("\n") || "No direct quotes addressing this question";
                
                contextMessage = `# Research Question Context: ${entityName}

## Question
${entity.observations.find(o => !o.startsWith("created:")) || entityName}

## Project
${projectName}

## Findings
${findingsText}

## Related Themes
${themesText}

## Supporting Quotes
${quotesText}`;
              } else {
                contextMessage = `# Research Question Context: ${entityName}

## Question
${entity.observations.find(o => !o.startsWith("created:")) || entityName}

## Project
${projectName}

No analysis data available for this research question.`;
              }
            } catch (error) {
              contextMessage = `# Research Question Context: ${entityName}

## Question
${entity.observations.find(o => !o.startsWith("created:")) || entityName}

## Project
${projectName}

No analysis data available for this research question.`;
            }
          }
          else {
            // Generic entity context for other entity types
            // Get related entities
            const relatedEntitiesData = await knowledgeGraphManager.getRelatedEntities(entityName);
            
            // Format observations
            const observationsText = entity.observations.map((obs: string) => `- ${obs}`).join("\n") || "No observations";
            
            // Format related entities
            const relatedText = Object.entries(relatedEntitiesData.related || {}).map(([relation, entities]) => {
              const entitiesList = (entities as any[]).map(e => `- **${e.name}** (${e.entityType})`).join("\n");
              return `### ${relation} (${(entities as any[]).length})\n${entitiesList}`;
            }).join("\n\n") || "No related entities found";
            
            contextMessage = `# Entity Context: ${entityName} (${entityType})

## Observations
${observationsText}

## Related Entities
${relatedText}`;
          }
          
          return {
            content: [{
              type: "text",
              text: contextMessage
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ 
                success: false,
                error: error instanceof Error ? error.message : String(error)
              }, null, 2)
            }]
          };
        }
      }
    );

    // Helper function to process each stage of endsession
    async function processStage(params: {
      sessionId: string;
      stage: string;
      stageNumber: number;
      totalStages: number;
      analysis?: string;
      stageData?: any;
      nextStageNeeded: boolean;
      isRevision?: boolean;
      revisesStage?: number;
    }, previousStages: any[]): Promise<any> {
      // Process based on the stage
      switch (params.stage) {
        case "summary":
          // Process summary stage
          return {
            stage: "summary",
            stageNumber: params.stageNumber,
            analysis: params.analysis || "",
            stageData: params.stageData || { 
              summary: "",
              duration: "",
              project: ""
            },
            completed: !params.nextStageNeeded
          };
          
        case "interviewData":
          // Process interview data stage
          return {
            stage: "interviewData",
            stageNumber: params.stageNumber,
            analysis: params.analysis || "",
            stageData: params.stageData || { interviews: [] },
            completed: !params.nextStageNeeded
          };
          
        case "memos":
          // Process memos stage
          return {
            stage: "memos",
            stageNumber: params.stageNumber,
            analysis: params.analysis || "",
            stageData: params.stageData || { memos: [] },
            completed: !params.nextStageNeeded
          };
          
        case "codingActivity":
          // Process coding activity stage
          return {
            stage: "codingActivity",
            stageNumber: params.stageNumber,
            analysis: params.analysis || "",
            stageData: params.stageData || { codes: [] },
            completed: !params.nextStageNeeded
          };
          
        case "themes":
          // Process themes stage
          return {
            stage: "themes",
            stageNumber: params.stageNumber,
            analysis: params.analysis || "",
            stageData: params.stageData || { themes: [] },
            completed: !params.nextStageNeeded
          };
          
        case "projectStatus":
          // Process project status stage
          return {
            stage: "projectStatus",
            stageNumber: params.stageNumber,
            analysis: params.analysis || "",
            stageData: params.stageData || { 
              projectStatus: "",
              projectObservation: ""
            },
            completed: !params.nextStageNeeded
          };
          
        case "assembly":
          // Final assembly stage - compile all arguments for end-session
          return {
            stage: "assembly",
            stageNumber: params.stageNumber,
            analysis: "Final assembly of end-session arguments",
            stageData: assembleEndSessionArgs(previousStages),
            completed: true
          };
          
        default:
          throw new Error(`Unknown stage: ${params.stage}`);
      }
    }

    // Helper function to assemble the final end-session arguments
    function assembleEndSessionArgs(stages: any[]): any {
      const summaryStage = stages.find(s => s.stage === "summary");
      const interviewDataStage = stages.find(s => s.stage === "interviewData");
      const memosStage = stages.find(s => s.stage === "memos");
      const codingActivityStage = stages.find(s => s.stage === "codingActivity");
      const themesStage = stages.find(s => s.stage === "themes");
      const projectStatusStage = stages.find(s => s.stage === "projectStatus");
      
      return {
        summary: summaryStage?.stageData?.summary || "",
        duration: summaryStage?.stageData?.duration || "unknown",
        project: summaryStage?.stageData?.project || "",
        interviewData: JSON.stringify(interviewDataStage?.stageData?.interviews || []),
        newMemos: JSON.stringify(memosStage?.stageData?.memos || []),
        codingActivity: JSON.stringify(codingActivityStage?.stageData?.codes || []),
        newThemes: JSON.stringify(themesStage?.stageData?.themes || []),
        projectStatus: projectStatusStage?.stageData?.projectStatus || "",
        projectObservation: projectStatusStage?.stageData?.projectObservation || ""
      };
    }

    /**
     * End session by processing all stages and recording the final results.
     * Only use this tool if the user asks for it.
     * 
     * Usage examples:
     * 
     * 1. Starting the end session process with the summary stage:
     * {
     *   "sessionId": "qual_1234567890_abc123",  // From startsession
     *   "stage": "summary",
     *   "stageNumber": 1,
     *   "totalStages": 6, 
     *   "analysis": "Analyzed progress on the interview data coding",
     *   "stageData": {
     *     "summary": "Completed initial coding of participant interviews",
     *     "duration": "3 hours",
     *     "project": "Health Behavior Study"  // Project name
     *   },
     *   "nextStageNeeded": true,  // More stages coming
     *   "isRevision": false
     * }
     * 
     * 2. Middle stage for themes:
     * {
     *   "sessionId": "qual_1234567890_abc123",
     *   "stage": "themes",
     *   "stageNumber": 2,
     *   "totalStages": 6,
     *   "analysis": "Identified emerging themes",
     *   "stageData": {
     *     "themes": [
     *       { "name": "Perceived Barriers", "codes": ["time_constraints", "financial_concerns"], "description": "Factors preventing healthy behaviors" },
     *       { "name": "Social Support", "codes": ["family_influence", "peer_encouragement"], "description": "External motivation from relationships" }
     *     ]
     *   },
     *   "nextStageNeeded": true,
     *   "isRevision": false
     * }
     * 
     * 3. Final assembly stage:
     * {
     *   "sessionId": "qual_1234567890_abc123",
     *   "stage": "assembly",
     *   "stageNumber": 6,
     *   "totalStages": 6,
     *   "nextStageNeeded": false,  // This completes the session
     *   "isRevision": false
     * }
     */
    server.tool(
      "endsession",
      toolDescriptions["endsession"],
      {
        sessionId: z.string().describe("The unique session identifier obtained from startsession"),
        stage: z.string().describe("Current stage of analysis: 'summary', 'themes', 'codes', 'memos', 'participantInsights', or 'assembly'"),
        stageNumber: z.number().int().positive().describe("The sequence number of the current stage (starts at 1)"),
        totalStages: z.number().int().positive().describe("Total number of stages in the workflow (typically 6 for standard workflow)"),
        analysis: z.string().optional().describe("Text analysis or observations for the current stage"),
        stageData: z.record(z.string(), z.any()).optional().describe(`Stage-specific data structure - format depends on the stage type:
        - For 'summary' stage: { summary: "Session summary text", duration: "3 hours", project: "Project Name" }
        - For 'themes' stage: { themes: [{ name: "Theme1", codes: ["code1", "code2"], description: "Theme description" }] }
        - For 'codes' stage: { codes: [{ name: "Code1", description: "Code meaning", quotes: ["Quote text"] }] }
        - For 'memos' stage: { memos: [{ title: "Memo title", content: "Detailed memo text", tags: ["tag1", "tag2"] }] }
        - For 'participantInsights' stage: { insights: [{ participant: "P1", observation: "Key insight about participant" }] }
        - For 'assembly' stage: no stageData needed - automatic assembly of previous stages`),
        nextStageNeeded: z.boolean().describe("Whether additional stages are needed after this one (false for final stage)"),
        isRevision: z.boolean().optional().describe("Whether this is revising a previous stage"),
        revisesStage: z.number().int().positive().optional().describe("If revising, which stage number is being revised")
      },
      async (params) => {
        try {
          // Load session states from persistent storage
          const sessionStates = await loadSessionStates();
          
          // Validate session ID
          if (!sessionStates.has(params.sessionId)) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ 
                  success: false,
                  error: `Session with ID ${params.sessionId} not found. Please start a new session with startsession.`
                }, null, 2)
              }]
            };
          }
          
          // Get or initialize session state
          let sessionState = sessionStates.get(params.sessionId) || [];
          
          // Process the current stage
          const stageResult = await processStage(params, sessionState);
          
          // Store updated state
          if (params.isRevision && params.revisesStage) {
            // Find the analysis stages in the session state
            const analysisStages = sessionState.filter(item => item.type === 'analysis_stage') || [];
            
            if (params.revisesStage <= analysisStages.length) {
              // Replace the revised stage
              analysisStages[params.revisesStage - 1] = {
                type: 'analysis_stage',
                ...stageResult
              };
            } else {
              // Add as a new stage
              analysisStages.push({
                type: 'analysis_stage',
                ...stageResult
              });
            }
            
            // Update the session state with the modified analysis stages
            sessionState = [
              ...sessionState.filter(item => item.type !== 'analysis_stage'),
              ...analysisStages
            ];
          } else {
            // Add new stage
            sessionState.push({
              type: 'analysis_stage',
              ...stageResult
            });
          }
          
          // Update in persistent storage
          sessionStates.set(params.sessionId, sessionState);
          await saveSessionStates(sessionStates);
          
          // Check if this is the final assembly stage and no more stages are needed
          if (params.stage === "assembly" && !params.nextStageNeeded) {
            // Get the assembled arguments
            const args = stageResult.stageData;
            
            try {
              // Parse arguments
              const summary = args.summary;
              const duration = args.duration;
              const project = args.project;
              const interviewData = args.interviewData ? JSON.parse(args.interviewData) : [];
              const newMemos = args.newMemos ? JSON.parse(args.newMemos) : [];
              const codingActivity = args.codingActivity ? JSON.parse(args.codingActivity) : [];
              const newThemes = args.newThemes ? JSON.parse(args.newThemes) : [];
              const projectStatus = args.projectStatus;
              const projectObservation = args.projectObservation;
              
              // Update project status using the relation-based approach
              try {
                // Set the project status using our helper method
                if (projectStatus) {
                  await knowledgeGraphManager.setEntityStatus(project, projectStatus);
                }
                
                // Add observation if provided
                if (projectObservation) {
                  await knowledgeGraphManager.addObservations([{
                    entityName: project,
                    contents: [projectObservation]
                  }]);
                }
              } catch (error) {
                console.error(`Error updating status for project ${project}:`, error);
              }
              
              // Record session completion in persistent storage
              sessionState.push({
                type: 'session_completed',
                timestamp: new Date().toISOString(),
                project
              });
              
              sessionStates.set(params.sessionId, sessionState);
              await saveSessionStates(sessionStates);
              
              // Prepare the summary message
              const summaryMessage = `# Qualitative Research Session Recorded

I've recorded your research session focusing on the ${project} project.

## Session Summary
${summary}

${interviewData.length > 0 ? `## Interviews Conducted
${interviewData.map((i: {participant: string, notes: string}) => 
  `- Interview with ${i.participant}`
).join('\n')}` : "No interviews were recorded."}

${newMemos.length > 0 ? `## Research Memos Created
${newMemos.map((m: {topic: string, content: string}) => `- ${m.topic}`).join('\n')}` : "No memos were created."}

${codingActivity.length > 0 ? `## Coding Activity
${codingActivity.map((c: {code: string, dataItem: string, note?: string}) => 
  `- Coded ${c.dataItem} with "${c.code}"${c.note ? `: ${c.note}` : ''}`
).join('\n')}` : "No coding was performed."}

${newThemes.length > 0 ? `## Themes Identified
${newThemes.map((t: {name: string, description: string}) => `- ${t.name}: ${t.description}`).join('\n')}` : "No themes were identified."}

## Project Status
Project ${project} has been updated to: ${projectStatus}

Would you like me to perform any additional updates to your qualitative research knowledge graph?`;
              
              // Return the final result with the session recorded message
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    success: true,
                    stageCompleted: params.stage,
                    nextStageNeeded: false,
                    stageResult: stageResult,
                    sessionRecorded: true,
                    summaryMessage: summaryMessage
                  }, null, 2)
                }]
              };
            } catch (error) {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    success: false,
                    error: `Error assembling end-session arguments: ${error instanceof Error ? error.message : String(error)}`
                  }, null, 2)
                }]
              };
            }
          } else {
            // This is not the final stage or more stages are needed
            // Return intermediate result
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: true,
                  stageCompleted: params.stage,
                  nextStageNeeded: params.nextStageNeeded,
                  stageResult: stageResult,
                  endSessionArgs: params.stage === "assembly" ? stageResult.stageData : null
                }, null, 2)
              }]
            };
          }
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Error recording qualitative research session: ${error instanceof Error ? error.message : String(error)}`
              }, null, 2)
            }]
          };
        }
      }
    );

    /**
     * Start a new session for qualitative research. Returns session ID, recent sessions, active projects, sample participants, top codes, and recent memos.
     * The output allows the user to easily choose what to focus on and which specific context to load.
     */
    server.tool(
      "startsession",
      toolDescriptions["startsession"],
      {},
      async () => {
        try {
          // Generate a unique session ID
          const sessionId = generateSessionId();
          
          // Get recent sessions from persistent storage
          const sessionStates = await loadSessionStates();

          // Initialize the session state
          sessionStates.set(sessionId, []);
          await saveSessionStates(sessionStates);
          
          // Convert sessions map to array and retrieve the most recent sessions
          const recentSessions = Array.from(sessionStates.entries())
            .map(([id, stages]) => {
              // Extract summary data from the first stage (if it exists)
              const summaryStage = stages.find(s => s.stage === "summary");
              return {
                id,
                project: summaryStage?.stageData?.project || "Unknown project",
                summary: summaryStage?.stageData?.summary || "No summary available"
              };
            })
            .slice(0, 3); // Default to showing 3 recent sessions
          
          // Query for all research projects and filter by status
          const projectsQuery = await knowledgeGraphManager.searchNodes("entityType:project");
          const projects = [];
          
          // Filter for active projects based on has_status relation
          for (const project of projectsQuery.entities) {
            const status = await knowledgeGraphManager.getEntityStatus(project.name);
            if (status === "active" || status === "in_progress" || status === "data_collection" || status === "analysis") {
              projects.push(project);
            }
          }
          
          // Query for a sample of participants
          const participantsQuery = await knowledgeGraphManager.searchNodes("entityType:participant");
          const participants = participantsQuery.entities.slice(0, 5); // Limit to 5 participants for initial display
          
          // Get all codes
          const codesQuery = await knowledgeGraphManager.searchNodes("entityType:code");
          const codes = codesQuery.entities.slice(0, 10); // Top 10 codes
          
          // Get recent memos
          const memosQuery = await knowledgeGraphManager.searchNodes("entityType:memo");
          const memos = memosQuery.entities.slice(0, 3); // Most recent 3 memos
          
          // Format the context information using entity-relation approach
          const projectsText = await Promise.all(projects.map(async p => {
            const status = await knowledgeGraphManager.getEntityStatus(p.name) || "Unknown";
            const priority = await knowledgeGraphManager.getEntityPriority(p.name);
            const priorityText = priority ? `, Priority: ${priority}` : "";
            
            // Show truncated preview of first observation
            const preview = p.observations.length > 0 
              ? `${p.observations[0].substring(0, 60)}${p.observations[0].length > 60 ? '...' : ''}`
              : "No description";
              
            return `- **${p.name}** (Status: ${status}${priorityText}): ${preview}`;
          }));
          
          const participantsText = await Promise.all(participants.map(async p => {
            const status = await knowledgeGraphManager.getEntityStatus(p.name) || "Active";
            
            // Show truncated preview of first observation for demographics
            const preview = p.observations.length > 0 
              ? `${p.observations[0].substring(0, 60)}${p.observations[0].length > 60 ? '...' : ''}`
              : "No demographics";
              
            return `- **${p.name}** (Status: ${status}): ${preview}`;
          }));
          
          const codesText = await Promise.all(codes.map(async c => {
            const status = await knowledgeGraphManager.getEntityStatus(c.name) || "initial";
            
            // Show truncated preview of first observation for description
            const preview = c.observations.length > 0 
              ? `${c.observations[0].substring(0, 60)}${c.observations[0].length > 60 ? '...' : ''}`
              : "No description";
              
            return `- **${c.name}** (Status: ${status}): ${preview}`;
          }));
          
          const memosText = await Promise.all(memos.map(async m => {
            const status = await knowledgeGraphManager.getEntityStatus(m.name) || "draft";
            
            // Show truncated preview of first observation for content
            const preview = m.observations.length > 0 
              ? `${m.observations[0].substring(0, 60)}${m.observations[0].length > 60 ? '...' : ''}`
              : "No content";
              
            return `- **${m.name}** (Status: ${status}): ${preview}`;
          }));
          
          const sessionsText = recentSessions.map(s => {
            return `- ${s.project} - ${s.summary.substring(0, 60)}${s.summary.length > 60 ? '...' : ''}`;
          }).join("\n");
          
          return {
            content: [{
              type: "text",
              text: `# Choose what to focus on in this session

## Session ID
\`${sessionId}\`

## Recent Research Sessions
${sessionsText || "No recent sessions found."}

## Active Research Projects
${projectsText.join("\n") || "No active projects found."}

## Sample Participants
${participantsText.join("\n") || "No participants found."}

## Top Codes
${codesText.join("\n") || "No codes found."}

## Recent Memos
${memosText.join("\n") || "No memos found."}

To load specific context, use the \`loadcontext\` tool with the entity name and session ID - ${sessionId}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ 
                success: false,
                error: error instanceof Error ? error.message : String(error)
              }, null, 2)
            }]
          };
        }
      }
    );

    /**
     * Create new entities, relations, and observations.
     */
    server.tool(
      "buildcontext",
      toolDescriptions["buildcontext"],
      {
        type: z.enum(["entities", "relations", "observations"]).describe("Type of creation operation: 'entities', 'relations', or 'observations'"),
        data: z.array(z.any()).describe("Data for the creation operation, structure varies by type but must be an array")
      },
      async ({ type, data }) => {
        try {
          let result;
          
          switch (type) {
            case "entities":
              // Validate entity types
              for (const entity of data) {
                if (!validateEntityType(entity.entityType)) {
                  throw new Error(`Invalid entity type: ${entity.entityType}`);
                }
              }
              
              // Ensure entities match the Entity interface
              const typedEntities: Entity[] = data.map((e: any) => ({
                name: e.name,
                entityType: e.entityType,
                observations: e.observations
              }));
              result = await knowledgeGraphManager.createEntities(typedEntities);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, created: result }, null, 2)
                }]
              };
              
            case "relations":
              // Validate relation types
              for (const relation of data) {
                if (!validateRelationType(relation.relationType)) {
                  throw new Error(`Invalid relation type: ${relation.relationType}`);
                }
              }
              
              // Ensure relations match the Relation interface
              const typedRelations: Relation[] = data.map((r: any) => ({
                from: r.from,
                to: r.to,
                relationType: r.relationType
              }));
              result = await knowledgeGraphManager.createRelations(typedRelations);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, created: result }, null, 2)
                }]
              };
              
            case "observations":
              // For qualitative researcher domain, addObservations takes an array
              // Ensure observations match the required interface
              const typedObservations: { entityName: string; contents: string[] }[] = 
                Array.isArray(data) ? data.map((o: any) => ({
                  entityName: o.entityName,
                  contents: Array.isArray(o.contents) ? o.contents : 
                           Array.isArray(o.observations) ? o.observations : []
                })) : [data];
              
              result = await knowledgeGraphManager.addObservations(typedObservations);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, added: result }, null, 2)
                }]
              };
              
            default:
              throw new Error(`Invalid type: ${type}. Must be 'entities', 'relations', or 'observations'.`);
          }
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ 
                success: false,
                error: error instanceof Error ? error.message : String(error)
              }, null, 2)
            }]
          };
        }
      }
    );
    
    /**
     * Delete entities, relations, or observations.
     */
    server.tool(
      "deletecontext",
      toolDescriptions["deletecontext"],
      {
        type: z.enum(["entities", "relations", "observations"]).describe("Type of deletion operation: 'entities', 'relations', or 'observations'"),
        data: z.array(z.any()).describe("Data for the deletion operation, structure varies by type but must be an array")
      },
      async ({ type, data }) => {
        try {
          switch (type) {
            case "entities":
              await knowledgeGraphManager.deleteEntities(data);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, message: `Deleted ${data.length} entities` }, null, 2)
                }]
              };
              
            case "relations":
              // Ensure relations match the Relation interface
              const typedRelations: Relation[] = data.map((r: any) => ({
                from: r.from,
                to: r.to,
                relationType: r.relationType
              }));
              await knowledgeGraphManager.deleteRelations(typedRelations);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, message: `Deleted ${data.length} relations` }, null, 2)
                }]
              };
              
            case "observations":
              // Ensure deletions match the required interface
              const typedDeletions: { entityName: string; observations: string[] }[] = data.map((d: any) => ({
                entityName: d.entityName,
                observations: d.observations
              }));
              await knowledgeGraphManager.deleteObservations(typedDeletions);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, message: `Deleted observations from ${data.length} entities` }, null, 2)
                }]
              };
              
            default:
              throw new Error(`Invalid type: ${type}. Must be 'entities', 'relations', or 'observations'.`);
          }
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ 
                success: false,
                error: error instanceof Error ? error.message : String(error)
              }, null, 2)
            }]
          };
        }
      }
    );
    
    /**
     * Get information about the graph, search for nodes, open nodes, get project overview, get participant profile, get codes, get themes, get transcript, get memo, get analysis, get codebook, or get related entities.
     */
    server.tool(
      "advancedcontext",
      toolDescriptions["advancedcontext"],
      {
        type: z.enum([
          "graph", 
          "search", 
          "nodes", 
          "project", 
          "participant", 
          "codes", 
          "themes", 
          "transcript", 
          "memo", 
          "analysis", 
          "codebook", 
          "related"
        ]).describe("Type of get operation"),
        params: z.record(z.string(), z.any()).describe("Parameters for the get operation, structure varies by type")
      },
      async ({ type, params }) => {
        try {
          let result;
          
          switch (type) {
            case "graph":
              result = await knowledgeGraphManager.readGraph();
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, graph: result }, null, 2)
                }]
              };
              
            case "search":
              result = await knowledgeGraphManager.searchNodes(params.query);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, results: result }, null, 2)
                }]
              };
              
            case "nodes":
              result = await knowledgeGraphManager.openNodes(params.names);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, nodes: result }, null, 2)
                }]
              };
              
            case "project":
              result = await knowledgeGraphManager.getProjectOverview(params.projectName);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, project: result }, null, 2)
                }]
              };
              
            case "participant":
              result = await knowledgeGraphManager.getParticipantProfile(params.participantName);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, participant: result }, null, 2)
                }]
              };
              
            case "codes":
              // Use searchNodes for codes instead of a specialized method
              result = await knowledgeGraphManager.searchNodes(`entityType:code ${params.projectName ? `project:${params.projectName}` : ""}`);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, codes: result }, null, 2)
                }]
              };
              
            case "themes":
              // Use searchNodes for themes
              result = await knowledgeGraphManager.searchNodes(`entityType:theme ${params.projectName ? `project:${params.projectName}` : ""}`);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, themes: result }, null, 2)
                }]
              };
              
            case "transcript":
              // Use searchNodes to find the transcript
              const transcriptQuery = await knowledgeGraphManager.searchNodes(
                `entityType:transcript participant:${params.participantName} ${params.interviewId ? `interview:${params.interviewId}` : ""}`
              );
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, transcript: transcriptQuery }, null, 2)
                }]
              };
              
            case "memo":
              // Use openNodes to get the specific memo
              const memoResult = await knowledgeGraphManager.openNodes([params.memoName]);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, memo: memoResult }, null, 2)
                }]
              };
              
            case "analysis":
              // Use searchNodes to get analysis artifacts
              const analysisQuery = await knowledgeGraphManager.searchNodes(`entityType:analysis project:${params.projectName}`);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, analysis: analysisQuery }, null, 2)
                }]
              };
              
            case "codebook":
              // Use searchNodes to get codebook entries
              const codebookQuery = await knowledgeGraphManager.searchNodes(`entityType:code project:${params.projectName}`);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({ success: true, codebook: codebookQuery }, null, 2)
                }]
              };
              
            case "related":
              // For the related case, we don't have a specialized method in the manager
              // So we'll use the generic KnowledgeGraph search capabilities
              const entityGraph = await knowledgeGraphManager.searchNodes(params.entityName);
              const entity = entityGraph.entities.find(e => e.name === params.entityName);
              
              if (!entity) {
                throw new Error(`Entity "${params.entityName}" not found`);
              }
              
              // Find related entities
              const relations = entityGraph.relations.filter(r => 
                r.from === params.entityName || r.to === params.entityName
              );
              
              const relatedNames = relations.map(r => 
                r.from === params.entityName ? r.to : r.from
              );
              
              if (relatedNames.length === 0) {
                return {
                  content: [{
                    type: "text",
                    text: JSON.stringify({ success: true, related: { entity, relatedEntities: [] } }, null, 2)
                  }]
                };
              }
              
              const relatedEntitiesGraph = await knowledgeGraphManager.openNodes(relatedNames);
              
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    success: true,
                    related: {
                      entity,
                      relations,
                      relatedEntities: relatedEntitiesGraph.entities
                    }
                  }, null, 2)
                }]
              };
              
            default:
              throw new Error(`Invalid type: ${type}. Must be one of the supported get operation types.`);
          }
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ 
                success: false,
                error: error instanceof Error ? error.message : String(error)
              }, null, 2)
            }]
          };
        }
      }
    );
  
    // Connect the server to the transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error("Unhandled error:", error);
  process.exit(1);
});

// Export the KnowledgeGraphManager for testing
export { KnowledgeGraphManager }; 