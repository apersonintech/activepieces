import { ProjectOperationType, ProjectSyncError } from '@activepieces/ee-shared'
import { FileCompression, FileId, FileType, FlowState, FlowStatus, isNil, ProjectId } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { fileService } from '../../../file/file.service'
import { flowRepo } from '../../../flows/flow/flow.repo'
import { flowService } from '../../../flows/flow/flow.service'
import { projectService } from '../../../project/project-service'
import { ProjectOperation } from '../project-diff/project-diff.service'
import { ProjectMappingState } from '../project-diff/project-mapping-state'
import { projectStateHelper } from './project-state-helper'

export const projectStateService = (log: FastifyBaseLogger) => ({
    async apply({ projectId, operations, mappingState, selectedOperations }: PullGitRepoRequest): Promise<ApplyProjectStateResponse> {
        let newMapState: ProjectMappingState = mappingState
        const publishJobs: Promise<ProjectSyncError | null>[] = []
        for (const operation of operations) {
            switch (operation.type) {
                case ProjectOperationType.UPDATE_FLOW: {
                    if (!isNil(selectedOperations) && !selectedOperations.includes(operation.newState.id)) {
                        continue
                    }
                    const flowUpdated = await projectStateHelper(log).updateFlowInProject(operation.oldState, operation.newState, projectId)
                    if (flowUpdated.status === FlowStatus.ENABLED) {
                        publishJobs.push(projectStateHelper(log).republishFlow(flowUpdated.id, projectId))
                    }
                    newMapState = newMapState.mapFlow({
                        sourceId: operation.newState.id,
                        targetId: flowUpdated.id,
                    })
                    break
                }
                case ProjectOperationType.CREATE_FLOW: {
                    if (!isNil(selectedOperations) && !selectedOperations.includes(operation.state.id)) {
                        continue
                    }
                    const flowCreated = await projectStateHelper(log).createFlowInProject(operation.state, projectId)
                    newMapState = newMapState.mapFlow({
                        sourceId: operation.state.id,
                        targetId: flowCreated.id,
                    })
                    break
                }
                case ProjectOperationType.DELETE_FLOW: {
                    if (!isNil(selectedOperations) && !selectedOperations.includes(operation.state.id)) {
                        continue
                    }
                    await projectStateHelper(log).deleteFlowFromProject(operation.state.id, projectId)
                    newMapState = newMapState.deleteFlow(operation.state.id)
                    break
                }
            }
        }
        console.log('updatingMappingState', newMapState)
        await projectService.update(projectId, { mapping: newMapState })
        const errors = (await Promise.all(publishJobs)).filter((f): f is ProjectSyncError => f !== null)
        return {
            errors,
        }
    },
    async save(projectId: ProjectId, name: string, log: FastifyBaseLogger): Promise<FileId> {
        const fileToSave: FlowState[] = await this.getCurrentState(projectId, log)
        
        const fileData = Buffer.from(JSON.stringify(fileToSave))
    
        const file = await fileService(log).save({
            projectId,
            type: FileType.PROJECT_RELEASE,
            fileName: `${name}.json`,
            size: fileData.byteLength,
            data: fileData,
            compression: FileCompression.NONE,
        })
        return file.id
    },
    async getNewState(projectId: ProjectId, fileId: FileId, log: FastifyBaseLogger): Promise<FlowState[]> {
        const file = await fileService(log).getFileOrThrow({
            projectId,
            fileId,
            type: FileType.PROJECT_RELEASE,
        })
        return JSON.parse(file.data.toString())
    },
    async getCurrentState(projectId: ProjectId, log: FastifyBaseLogger): Promise<FlowState[]> {
        const flows = await flowRepo().find({
            where: {
                projectId,
            },
        })
        const allPopulatedFlows = await Promise.all(flows.map(async (flow) => {
            return flowService(log).getOnePopulatedOrThrow({
                id: flow.id,
                projectId,
            })
        }))
        return allPopulatedFlows
    },
    async getMappingState(projectId: ProjectId, stateOne: FlowState[], stateTwo: FlowState[]): Promise<ProjectMappingState> {
        const project = await projectService.getOneOrThrow(projectId)
        const mappingState = (project.mapping ? new ProjectMappingState(project.mapping) : ProjectMappingState.empty()).merge({
            stateOne,
            stateTwo,
        })
        return mappingState
    },
})

type ApplyProjectStateResponse = {
    errors: ProjectSyncError[]
}

type PullGitRepoRequest = {
    projectId: string
    operations: ProjectOperation[]
    mappingState: ProjectMappingState
    selectedOperations?: string[]
}
