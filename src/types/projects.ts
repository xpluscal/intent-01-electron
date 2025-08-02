// Project and Reference type definitions

export interface Project {
  id: string
  name: string
  description?: string
  emoji?: string
  created: Date
  modified: Date
  refs: string[] // Reference IDs
  settings?: ProjectSettings
}

export interface ProjectSettings {
  defaultBranch?: string
  autoSync?: boolean
  buildCommand?: string
  testCommand?: string
}

export type ReferenceType = 'reference' | 'artifact'
export type ReferenceSubtype = 
  | 'document'  // for reference type
  | 'media'     // for reference type
  | 'code'      // for artifact type
  | 'text'      // for artifact type
  | 'media-artifact' // for artifact type (renamed to avoid conflict)

export interface Reference {
  id: string
  name: string
  description?: string
  type: ReferenceType
  subtype: ReferenceSubtype
  projects: string[] // Project IDs this ref belongs to
  readReferences?: string[] // Reference IDs this artifact can read from (only for artifacts)
  source?: {
    type: 'git' | 'local'
    url?: string
    branch?: string
  }
  created: Date
  modified: Date
}

export interface ProjectsMetadata {
  version: string
  projects: Record<string, Project>
}

export interface RefMetadata {
  version: string
  reference: Reference
}

// Extended FileNode for project-aware file tree
export interface ProjectFileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  nodeType?: 'project' | 'reference' | 'folder'
  projectId?: string // For references to track parent project
  refId?: string // For reference nodes
  children?: ProjectFileNode[]
  metadata?: {
    created: Date
    modified: Date
    description?: string
    refType?: ReferenceType
    refSubtype?: ReferenceSubtype
    emoji?: string
    readRefCount?: number
  }
}