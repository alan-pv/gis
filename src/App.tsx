/**
 * App.tsx — composition root of Gis.
 *
 * Mounts the <AppShell> (menu bar, toolbar, page rail, the centered Konva canvas
 * and the overlays layer) and wires the hooks that own each concern:
 *
 *   useDocumentState  the multi-page document (scene + ink per page), undo
 *   useBoardTools     the teacher's manual tools: pen, eraser, selection, text, shapes
 *   usePages          page navigation and thumbnails
 *   useTurnQueue      live session: utterance queue → sidecar → envelope → board
 *   useSpeechInput    Web Speech microphone (continuous + push to talk)
 *   useLessonPlayer   replay of the recorded lessons
 *   useDevConsole     developer console: raw envelope box, lesson loader
 *
 * Every envelope — from the sidecar, from a recorded lesson or pasted in the
 * console — goes through the same path: apply (validate + layout) → animate.
 * Validation mode per entry (operation cap): speech and lessons use 'live'
 * (20 operations); the console box and manual edits use 'slide' (200).
 *
 * The canvas is remounted with key={active page number} so its registry and
 * revealed set are fresh on every page change.
 */
import { useState, useCallback } from 'react'
import { AppShell } from '@/ui/AppShell.js'
import { MenuBar } from '@/ui/MenuBar.js'
import { MicButton } from '@/ui/MicButton.js'
import { Toolbar } from '@/ui/Toolbar.js'
import { LessonDialog } from '@/ui/LessonDialog.js'
import { LessonPlayerBar } from '@/ui/LessonPlayerBar.js'
import { StatusBanners } from '@/ui/StatusBanners.js'
import { SpeechStatus } from '@/ui/SpeechStatus.js'
import { AreaMenu, AreasToggle } from '@/ui/AreaMenu.js'
import { DevConsole } from '@/ui/console/DevConsole.js'
import lessonStyles from '@/ui/Lessons.module.css'
import { loadLibrary } from '@/library/index.js'
import { buildTemplatesFromLibrary } from '@/recognizer/index.js'
import { PageThumbnails } from '@/canvas/PageThumbnails.js'
import { SceneCanvas } from '@/canvas/SceneCanvas.js'
import { BoardOverlays } from '@/canvas/BoardOverlays.js'
import { CANVAS_W, CANVAS_H } from '@/canvas/board-size.js'
import { useDocumentState } from '@/hooks/useDocumentState.js'
import { useStageFit } from '@/hooks/useStageFit.js'
import { useAreaEditing } from '@/hooks/useAreaEditing.js'
import { useBoardTools } from '@/hooks/useBoardTools.js'
import { usePages } from '@/hooks/usePages.js'
import { useDevConsole } from '@/hooks/useDevConsole.js'
import { useTurnQueue } from '@/hooks/useTurnQueue.js'
import { useSpeechInput } from '@/hooks/useSpeechInput.js'
import { activePage, activeScene, activeInk } from '@/document/index.js'
import type { ValidationMode } from '@/validator/index.js'
import { loadSeeds } from '@/demo/lessons.js'
import { isDemoMode, DEMO_MIC_MESSAGE } from '@/demo/demo-mode.js'
import { useLessonPlayer } from '@/demo/useLessonPlayer.js'

const library = loadLibrary()
const recognizerTemplates = buildTemplatesFromLibrary(library)
const lessons = loadSeeds()

function App() {
  // Static demo build (npm run build:demo): no sidecar, mic disabled.
  const demo = isDemoMode()

  const { state, applyEnvelope, objectMoved, stepsConsumed,
    addPage: dispatchAddPage, removePage: dispatchRemovePage,
    setActivePage: dispatchSetActivePage, resetDocument,
    addInkStroke, removeInkStroke, promoteInkStrokes,
    moveInkStroke, removeObject, removeHighlight, undo, canUndo,
    setAreaTree } = useDocumentState()

  /** true while a turn's animation is playing. */
  const [isRunning, setIsRunning] = useState(false)
  /** true while the interpreter agent is processing. */
  const [isInterpreting, setIsInterpreting] = useState(false)
  /** Error banner (parse or agent) and informative banner (empty response). */
  const [parseError, setParseError] = useState<string | null>(null)
  const [agentInfo, setAgentInfo] = useState<string | null>(null)

  const { stageContainerRef, stageRect, view } = useStageFit()
  const areas = useAreaEditing(state.document, setAreaTree)

  const tools = useBoardTools({
    document: state.document, library, recognizerTemplates, isRunning, isInterpreting, setIsRunning,
    applyEnvelope, objectMoved, removeInkStroke, moveInkStroke, removeObject, undo, promoteInkStrokes,
  })

  /**
   * Shared application path for an envelope: apply (validate + layout) → animate.
   * Used by the console "Run" button and by the lesson player, so a replayed lesson
   * looks exactly like live use. Returns the number of animation steps.
   */
  const applyAndAnimate = useCallback((envelope: unknown, mode: ValidationMode): number => {
    setParseError(null)
    setAgentInfo(null)
    // Applying an envelope may change the canvas: hide the shape menu and the selection
    tools.clearTransient()
    const { steps } = applyEnvelope(envelope, library, { width: CANVAS_W, height: CANVAS_H }, mode)
    if (steps > 0) setIsRunning(true)
    return steps
  }, [applyEnvelope, tools])

  const pages = usePages({
    document: state.document, setIsRunning, clearTransient: tools.clearTransient, setSelectedId: tools.setSelectedId,
    dispatchSetActivePage, dispatchAddPage, dispatchRemovePage,
  })

  const devConsole = useDevConsole({
    seeds: lessons, isRunning, applyAndAnimate, setParseError, resetDocument, clearSnapshots: pages.clearSnapshots,
  })

  const turns = useTurnQueue({
    document: state.document, library, applyEnvelope, isRunning, isInterpreting, setIsRunning, setIsInterpreting,
    setParseError, setAgentInfo, clearTransient: tools.clearTransient, showTurn: devConsole.showTurn,
  })

  const speech = useSpeechInput({
    demo, isRunning, isInterpreting, enqueuePhrase: turns.enqueuePhrase, setParseError,
  })

  const handleAnimationDone = useCallback(() => setIsRunning(false), [])

  /** Full reset: stops listening and clears the session, the tools and the board. */
  const handleReset = useCallback(() => {
    speech.reset()
    devConsole.resetLoader()
    setIsRunning(false)
    setIsInterpreting(false)
    setParseError(null)
    setAgentInfo(null)
    turns.reset()
    tools.reset()
    // New single empty page; no animation (no setIsRunning(true))
    resetDocument()
    pages.clearSnapshots()
  }, [speech, devConsole, turns, tools, resetDocument, pages])

  // ── Lesson player (recorded lessons, same path as live envelopes) ──────────
  const [lessonDialogOpen, setLessonDialogOpen] = useState(false)
  // Demo build: the welcome card (with the lesson list) opens on first load.
  const [welcomeOpen, setWelcomeOpen] = useState(demo)

  const playLessonTurn = useCallback((envelope: unknown) => {
    // 'live' like real turns: same validator caps and same animation.
    applyAndAnimate(envelope, 'live')
  }, [applyAndAnimate])

  const lessonPlayer = useLessonPlayer({
    seeds: lessons,
    animating: isRunning || isInterpreting,
    playTurn: playLessonTurn,
    onStart: handleReset,
  })

  const handlePickLesson = useCallback((seedId: string) => {
    setLessonDialogOpen(false)
    setWelcomeOpen(false)
    lessonPlayer.start(seedId)
  }, [lessonPlayer])

  const handleNewBoard = useCallback(() => {
    lessonPlayer.stop()
    handleReset()
  }, [lessonPlayer, handleReset])

  // Sidecar badge (visible only in developer mode, in the menu bar)
  const providerBadge = speech.sidecarOk === undefined
    ? '…'
    : speech.sidecarOk
      ? 'Laya + gis-texto'
      : 'sidecar offline'
  const providerTone: 'loading' | 'none' | 'ok' = speech.sidecarOk === undefined
    ? 'loading'
    : speech.sidecarOk
      ? 'ok'
      : 'none'

  const scene = activeScene(state.document)
  const canvasBounds = { width: CANVAS_W, height: CANVAS_H }

  return (
    <AppShell
      menubar={
        <MenuBar
          onNew={handleNewBoard}
          onUndo={tools.handleUndo}
          canUndo={canUndo}
          onInsertPage={pages.handleAddPage}
          devMode={devConsole.devMode}
          onToggleDevMode={() => devConsole.setDevMode(v => !v)}
          onImportJson={devConsole.handleImportJson}
          providerBadge={providerBadge}
          providerTone={providerTone}
          onOpenLessons={() => setLessonDialogOpen(true)}
          demo={demo}
        />
      }
      toolbar={
        <Toolbar
          tool={tools.tool}
          onSetTool={tools.handleSetTool}
          penColor={tools.penColor}
          onSetPenColor={tools.setPenColor}
          canUndo={canUndo}
          onUndo={tools.handleUndo}
        />
      }
      banners={
        devConsole.devMode && !demo && (
          <StatusBanners parseError={parseError} agentInfo={agentInfo} warnings={state.warnings} />
        )
      }
      rail={
        /* Vertical rail of page thumbnails */
        <PageThumbnails
          pages={state.document.pages}
          activeIndex={state.document.activeIndex}
          canvasWidth={CANVAS_W}
          canvasHeight={CANVAS_H}
          disabled={isInterpreting}
          onSelect={pages.handleSelectPage}
          onAdd={pages.handleAddPage}
          onRemove={pages.handleRemovePage}
          orientation="vertical"
          library={library}
          snapshots={pages.pageSnapshots}
        />
      }
      stage={
        /* Canvas container: position:relative for the overlays; width/height 100% fill the
           visible area of the AppShell "stage" slot — the ResizeObserver of stageContainerRef
           measures THIS size, not the logical canvas size. */
        <div ref={stageContainerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
          <SceneCanvas
            key={activePage(state.document).number}
            scene={scene}
            library={library}
            pendingSteps={state.pendingSteps}
            onStepsConsumed={stepsConsumed}
            width={CANVAS_W}
            height={CANVAS_H}
            viewportWidth={stageRect?.width}
            viewportHeight={stageRect?.height}
            onObjectMoved={objectMoved}
            onAnimationDone={handleAnimationDone}
            onSnapshot={pages.handleSnapshot}
            tool={tools.tool}
            ink={activeInk(state.document)}
            onInkStrokeAdded={(points) => addInkStroke(points, tools.penColor)}
            penColor={tools.penColor}
            onInkStrokeErased={tools.handleInkStrokeErased}
            onObjectErased={removeObject}
            onHighlightErased={removeHighlight}
            onInkStrokeMoved={tools.handleInkStrokeMoved}
            onMarqueeSelect={tools.handleMarqueeSelect}
            selectedId={tools.selectedId}
            onSelectObject={tools.setSelectedId}
            onRequestTextBox={tools.handleRequestTextBox}
            onRequestEditText={tools.handleRequestEditText}
            editingId={tools.editingId}
            view={view}
            areaTree={activePage(state.document).areaTree}
            showAreas={devConsole.devMode && areas.showAreas}
            selectedAreaId={areas.selectedAreaId}
            onRequestAreaMenu={(areaId, screen) => areas.setAreaMenu({ areaId, x: screen.x, y: screen.y })}
            onResizeArea={areas.handleResizeArea}
          />
          <BoardOverlays
            scene={scene}
            view={view}
            library={library}
            textBoxAt={tools.textBoxAt}
            onTextBoxConfirm={tools.handleTextBoxConfirm}
            onTextBoxCancel={tools.handleTextBoxCancel}
            editingId={tools.editingId}
            onEditCommit={tools.handleEditCommit}
            onEditCancel={tools.handleEditCancel}
            inkSelection={tools.inkSelection}
            selectionSuggestion={tools.selectionSuggestion}
            onPromote={tools.handlePromote}
            onCloseShapeMenu={tools.handleCloseShapeMenu}
            selectedId={tools.selectedId}
            onDeleteSelected={() => {
              if (tools.selectedId !== null) removeObject(tools.selectedId)
              tools.setSelectedId(null)
            }}
          />
          {devConsole.devMode && (
            <AreasToggle
              checked={areas.showAreas}
              onChange={checked => { areas.setShowAreas(checked); if (!checked) areas.setAreaMenu(null) }}
            />
          )}
          {areas.areaMenu !== null && (
            <AreaMenu
              areaId={areas.areaMenu.areaId}
              x={areas.areaMenu.x}
              y={areas.areaMenu.y}
              tree={activePage(state.document).areaTree}
              canvas={canvasBounds}
              setAreaTree={setAreaTree}
              onClose={() => areas.setAreaMenu(null)}
            />
          )}
        </div>
      }
      overlays={
        <>
          {devConsole.devMode && !demo && (
            <DevConsole
              collapsed={devConsole.consoleCollapsed}
              onToggleCollapse={() => devConsole.setConsoleCollapsed(c => !c)}
              document={state.document}
              queue={{ queue: turns.queue, onForce: turns.handleForceItem, onClear: turns.handleClearQueue }}
              phrase={{
                agentInput: turns.agentInput,
                onChange: turns.setAgentInput,
                onInterpret: turns.handleInterpret,
                recentUtterances: turns.recentUtterances,
              }}
              pushToTalk={{
                busy: isRunning || isInterpreting,
                recording: speech.isWebSpeechRecording,
                partial: speech.webSpeechPartial,
                onPointerDown: speech.handleWebSpeechPttDown,
                onPointerUp: speech.handleWebSpeechPttUp,
              }}
              envelope={{
                seeds: lessons,
                selectedSeedId: devConsole.selectedSeedId,
                selectedSeed: devConsole.selectedSeed,
                seedStep: devConsole.seedStep,
                register: devConsole.register,
                loadedCaseTags: devConsole.loadedCaseTags,
                activeUtterance: devConsole.activeUtterance,
                envelopeText: devConsole.envelopeText,
                parseError,
                isRunning,
                onSelectSeed: devConsole.handleSelectSeed,
                onSetRegister: devConsole.setRegister,
                onLoadTurn: devConsole.handleLoadTurn,
                onRun: devConsole.handleRun,
                onResetBoard: devConsole.handleResetBoard,
                onTextChange: devConsole.handleTextChange,
              }}
            />
          )}
          <SpeechStatus showPrivacyBadge={!demo} listening={speech.isContinuous} partial={speech.webSpeechPartial} />
          {/* Teacher microphone: always visible, not gated by developer mode. */}
          <MicButton
            active={speech.isContinuous}
            disabled={demo || lessonPlayer.active}
            disabledReason={demo ? DEMO_MIC_MESSAGE : 'Stop the lesson to use the microphone'}
            onClick={speech.handleMicClick}
          />
          {speech.notice !== null && !lessonPlayer.active && (
            <div className={lessonStyles.notice} role="alert">{speech.notice}</div>
          )}
          {lessonPlayer.active && lessonPlayer.seed !== null && (
            <LessonPlayerBar
              state={lessonPlayer.state}
              title={lessonPlayer.seed.label}
              caption={lessonPlayer.caption}
              canNext={lessonPlayer.canNext}
              onPause={lessonPlayer.pause}
              onResume={lessonPlayer.resume}
              onNext={lessonPlayer.next}
              onStop={lessonPlayer.stop}
            />
          )}
          <LessonDialog
            open={lessonDialogOpen || welcomeOpen}
            onOpenChange={(o) => { if (!o) { setLessonDialogOpen(false); setWelcomeOpen(false) } }}
            lessons={lessons}
            onPick={handlePickLesson}
            welcome={welcomeOpen}
          />
        </>
      }
    />
  )
}

export default App
