import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export function useFileSystem() {
  const [workspacePath, setWorkspacePath] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    window.intentAPI.getWorkspacePath().then(setWorkspacePath)
  }, [])

  const listFiles = useCallback(async (dirPath: string): Promise<FileNode[]> => {
    try {
      const files = await window.intentAPI.listFiles(dirPath)
      return files
    } catch (error) {
      toast.error('Failed to list files')
      console.error(error)
      return []
    }
  }, [])

  const readFile = useCallback(async (filePath: string): Promise<string> => {
    try {
      return await window.intentAPI.readFile(filePath)
    } catch (error) {
      toast.error('Failed to read file')
      throw error
    }
  }, [])

  const writeFile = useCallback(async (filePath: string, content: string): Promise<boolean> => {
    try {
      return await window.intentAPI.writeFile(filePath, content)
    } catch (error) {
      toast.error('Failed to write file')
      throw error
    }
  }, [])

  const createFile = useCallback(async (filePath: string, content: string = ''): Promise<boolean> => {
    try {
      return await window.intentAPI.createFile(filePath, content)
    } catch (error) {
      toast.error('Failed to create file')
      throw error
    }
  }, [])

  const deleteFile = useCallback(async (filePath: string): Promise<boolean> => {
    try {
      return await window.intentAPI.deleteFile(filePath)
    } catch (error) {
      toast.error('Failed to delete file')
      throw error
    }
  }, [])

  const createDirectory = useCallback(async (dirPath: string): Promise<boolean> => {
    try {
      return await window.intentAPI.createDirectory(dirPath)
    } catch (error) {
      toast.error('Failed to create directory')
      throw error
    }
  }, [])

  const buildFileTree = useCallback(async (dirPath: string = 'refs'): Promise<FileNode[]> => {
    setIsLoading(true)
    try {
      const items = await listFiles(dirPath)
      
      // Filter out .intent-ref.json files
      const filteredItems = items.filter(item => item.name !== '.intent-ref.json')
      
      // Recursively build tree for directories
      const tree = await Promise.all(
        filteredItems.map(async (item) => {
          if (item.type === 'directory') {
            const children = await buildFileTree(item.path)
            return { ...item, children }
          }
          return item
        })
      )
      
      return tree
    } catch (error) {
      console.error('Failed to build file tree:', error)
      return []
    } finally {
      setIsLoading(false)
    }
  }, [listFiles])

  return {
    workspacePath,
    isLoading,
    listFiles,
    readFile,
    writeFile,
    createFile,
    deleteFile,
    createDirectory,
    buildFileTree
  }
}