#!/usr/bin/env node
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
declare class KnowledgeGraphManager {
    private loadGraph;
    private saveGraph;
    initializeStatusAndPriority(): Promise<void>;
    getEntityStatus(entityName: string): Promise<string | null>;
    getEntityPriority(entityName: string): Promise<string | null>;
    setEntityStatus(entityName: string, statusValue: string): Promise<void>;
    setEntityPriority(entityName: string, priorityValue: string): Promise<void>;
    createEntities(entities: Entity[]): Promise<Entity[]>;
    createRelations(relations: Relation[]): Promise<Relation[]>;
    addObservations(observations: {
        entityName: string;
        contents: string[];
    }[]): Promise<{
        entityName: string;
        addedObservations: string[];
    }[]>;
    deleteEntities(entityNames: string[]): Promise<void>;
    deleteObservations(deletions: {
        entityName: string;
        observations: string[];
    }[]): Promise<void>;
    deleteRelations(relations: Relation[]): Promise<void>;
    readGraph(): Promise<KnowledgeGraph>;
    searchNodes(query: string): Promise<KnowledgeGraph>;
    openNodes(names: string[]): Promise<KnowledgeGraph>;
    getProjectOverview(projectName: string): Promise<any>;
    getParticipantProfile(participantName: string): Promise<any>;
    getThematicAnalysis(projectName: string): Promise<any>;
    getCodedData(codeName: string): Promise<any>;
    getResearchQuestionAnalysis(projectName: string): Promise<any>;
    getChronologicalData(projectName: string, dataType?: string): Promise<any>;
    getCodeCooccurrence(codeName: string): Promise<any>;
    getMemosByFocus(entityName: string): Promise<any>;
    getMethodologyDetails(projectName: string): Promise<any>;
    getRelatedEntities(entityName: string, relationTypes?: string[]): Promise<any>;
}
export { KnowledgeGraphManager };
