import { threadSafeMkdir } from '@activepieces/server-shared'
import { PiecePackage, PieceType } from '@activepieces/shared'
import { pieceManager } from '../piece-manager'
import { codeBuilder } from '../utils/code-builder'
import { engineInstaller } from '../utils/engine-installer'
import { CodeArtifact } from './engine-runner'
import { FastifyBaseLogger } from 'fastify'

export const executionFiles = (log: FastifyBaseLogger) => ({
    async provision({
        pieces,
        globalCachePath,
        codeSteps,
        globalCodesPath,
        customPiecesPath,
    }: ProvisionParams): Promise<void> {
        const startTime = performance.now()

        await threadSafeMkdir(globalCachePath)

        const startTimeCode = performance.now()
        const buildJobs = codeSteps.map(async (artifact) => {
            return codeBuilder(log).processCodeStep({
                artifact,
                codesFolderPath: globalCodesPath,
            })
        })
        await Promise.all(buildJobs)
        log.info({
            path: globalCachePath,
            timeTaken: `${Math.floor(performance.now() - startTimeCode)}ms`,
        }, 'Installed code in sandbox')

        const startTimeEngine = performance.now()
        await engineInstaller(log).install({
            path: globalCachePath,
        })
        log.info({
            path: globalCachePath,
            timeTaken: `${Math.floor(performance.now() - startTimeEngine)}ms`,
        }, 'Installed engine in sandbox')

        const officialPieces = pieces.filter(f => f.pieceType === PieceType.OFFICIAL)
        if (officialPieces.length > 0) {
            const startTime = performance.now()
            await pieceManager.install({
                projectPath: globalCachePath,
                pieces: officialPieces,
            })
            log.info({
                pieces: officialPieces.map(p => `${p.pieceName}@${p.pieceVersion}`),
                globalCachePath,
                timeTaken: `${Math.floor(performance.now() - startTime)}ms`,
            }, 'Installed official pieces in sandbox')
        }

        const customPieces = pieces.filter(f => f.pieceType === PieceType.CUSTOM)
        if (customPieces.length > 0) {
            const startTime = performance.now()
            await threadSafeMkdir(customPiecesPath)
            await pieceManager.install({
                projectPath: customPiecesPath,
                pieces: customPieces,
            })
            log.info({
                customPieces: customPieces.map(p => `${p.pieceName}@${p.pieceVersion}`),
                customPiecesPath,
                timeTaken: `${Math.floor(performance.now() - startTime)}ms`,
            }, 'Installed custom pieces in sandbox')
        }

        log.info({
            timeTaken: `${Math.floor(performance.now() - startTime)}ms`,
        }, 'Sandbox installation complete')

    },
})

type ProvisionParams = {
    pieces: PiecePackage[]
    codeSteps: CodeArtifact[]
    globalCachePath: string
    globalCodesPath: string
    customPiecesPath: string
}
