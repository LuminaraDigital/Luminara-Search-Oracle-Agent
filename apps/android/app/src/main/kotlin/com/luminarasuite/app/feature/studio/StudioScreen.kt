package com.luminarasuite.app.feature.studio

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material.icons.outlined.LibraryBooks
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewModelScope
import com.luminarasuite.app.core.designsystem.AccentHeadline
import com.luminarasuite.app.core.designsystem.AiEvidenceDisclosureBar
import com.luminarasuite.app.core.designsystem.EmptyStateCard
import com.luminarasuite.app.core.designsystem.EyebrowKicker
import com.luminarasuite.app.core.designsystem.FoundryButton
import com.luminarasuite.app.core.designsystem.FoundryFieldColors
import com.luminarasuite.app.core.designsystem.GhostPillButton
import com.luminarasuite.app.core.designsystem.LiveEyebrow
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraOrb
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.PromptBar
import com.luminarasuite.app.core.designsystem.ReportAiOutput
import com.luminarasuite.app.core.designsystem.ScreenGutter
import com.luminarasuite.app.core.designsystem.SectionHeader
import com.luminarasuite.app.core.designsystem.WorkbenchCard
import com.luminarasuite.app.core.model.AudioOverview
import com.luminarasuite.app.core.model.AudioOverviewTurn
import com.luminarasuite.app.core.model.StudioSource
import com.luminarasuite.app.core.network.LuminaraRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.Locale

data class StudioUiState(
    val prompt: String = "",
    val isAsking: Boolean = false,
    val answer: String? = null,
    val answerReported: Boolean = false,
    val overviewReported: Boolean = false,
    val isGenerating: Boolean = false,
    val overview: AudioOverview? = null,
    val errorMessage: String? = null,
)

class StudioViewModel(
    private val repository: LuminaraRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(StudioUiState())
    val uiState: StateFlow<StudioUiState> = _uiState.asStateFlow()

    val sources: StateFlow<List<StudioSource>> =
        repository.studioSourcesFlow.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    fun updatePrompt(value: String) = _uiState.update { it.copy(prompt = value) }

    fun addNote(
        title: String,
        body: String,
    ) {
        viewModelScope.launch {
            repository.addStudioSource(title.ifBlank { body.take(48) }, body, "note")
        }
    }

    fun toggle(source: StudioSource) {
        viewModelScope.launch { repository.setStudioSourceSelected(source.id, !source.selected) }
    }

    fun remove(source: StudioSource) {
        viewModelScope.launch { repository.removeStudioSource(source.id) }
    }

    fun ask() {
        val question = _uiState.value.prompt.trim()
        if (question.isEmpty()) return
        _uiState.update { it.copy(prompt = "", isAsking = true, errorMessage = null) }
        viewModelScope.launch {
            repository.askStudio(question)
                .onSuccess { answer ->
                    _uiState.update { it.copy(isAsking = false, answer = answer, answerReported = false) }
                }
                .onFailure { err -> _uiState.update { it.copy(isAsking = false, errorMessage = err.message) } }
        }
    }

    fun reportAnswer() {
        viewModelScope.launch {
            repository.reportOracleTurn("studio-answer-${_uiState.value.answer.hashCode()}")
            _uiState.update { it.copy(answerReported = true) }
        }
    }

    fun reportOverview() {
        viewModelScope.launch {
            repository.reportOracleTurn("studio-audio-${_uiState.value.overview.hashCode()}")
            _uiState.update { it.copy(overviewReported = true) }
        }
    }

    fun generateOverview() {
        _uiState.update { it.copy(isGenerating = true, errorMessage = null) }
        viewModelScope.launch {
            repository.generateAudioOverview()
                .onSuccess { overview ->
                    _uiState.update { it.copy(isGenerating = false, overview = overview, overviewReported = false) }
                }
                .onFailure { err -> _uiState.update { it.copy(isGenerating = false, errorMessage = err.message) } }
        }
    }
}

@Composable
fun StudioScreen(viewModel: StudioViewModel) {
    val state by viewModel.uiState.collectAsState()
    val sources by viewModel.sources.collectAsState()
    val active = sources.count { it.selected }

    Column(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier =
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = ScreenGutter, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            LiveEyebrow("Studio")
            AccentHeadline(lead = "Listen to ", accent = "your evidence")
            Text(
                text = "Saved on this phone. Sources you select are sent to the AI provider to answer you.",
                style = LuminaraTextStyles.Body,
            )
            SectionHeader(title = "Sources", trailing = "$active of ${sources.size} active")
            if (sources.isEmpty()) {
                EmptyStateCard(
                    title = "No sources yet",
                    body = "Add a note here, or send an audit or idea card to Studio.",
                    icon = Icons.Outlined.LibraryBooks,
                )
            } else {
                sources.forEach { source ->
                    SourceRow(
                        source = source,
                        onToggle = { viewModel.toggle(source) },
                        onRemove = { viewModel.remove(source) },
                    )
                }
            }
            AddNoteCard(onAdd = viewModel::addNote)

            state.errorMessage?.let {
                WorkbenchCard(railColor = LuminaraColors.ErrorRed) {
                    Text(text = it, style = LuminaraTextStyles.Body, color = LuminaraColors.ErrorRed)
                }
            }
            AudioCard(
                state = state,
                canGenerate = active > 0,
                onGenerate = viewModel::generateOverview,
                onReport = viewModel::reportOverview,
            )
            state.answer?.let { answer ->
                WorkbenchCard {
                    EyebrowKicker("Grounded answer")
                    Text(text = answer, style = LuminaraTextStyles.Body.copy(color = LuminaraColors.Ink))
                    ReportAiOutput(reported = state.answerReported, onReport = viewModel::reportAnswer)
                }
            }
            if (state.isAsking) {
                LuminaraOrb(size = 72.dp, thinking = true)
            }
            AiEvidenceDisclosureBar(note = "AI output can be wrong. Check the sources before acting.")
            Spacer(modifier = Modifier.height(8.dp))
        }
        PromptBar(
            value = state.prompt,
            onValueChange = viewModel::updatePrompt,
            placeholder = "Query your $active active sources",
            onSend = viewModel::ask,
            busy = state.isAsking || active == 0,
            modifier = Modifier.padding(horizontal = ScreenGutter, vertical = 8.dp),
            inputTag = "studio_prompt_input",
            sendTag = "studio_send_button",
        )
    }
}

@Composable
private fun SourceRow(
    source: StudioSource,
    onToggle: () -> Unit,
    onRemove: () -> Unit,
) {
    WorkbenchCard(emphasized = source.selected, onClick = onToggle) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                EyebrowKicker(source.kind)
                Text(text = source.title, style = LuminaraTextStyles.SectionTitle.copy(fontSize = 14.sp), maxLines = 2)
            }
            Box(
                modifier =
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .clickable(role = Role.Button, onClick = onRemove),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Close, contentDescription = "Remove source", tint = LuminaraColors.Ink3)
            }
        }
    }
}

@Composable
private fun AddNoteCard(onAdd: (String, String) -> Unit) {
    var body by rememberSaveable { mutableStateOf("") }
    WorkbenchCard {
        EyebrowKicker("Add a note")
        OutlinedTextField(
            value = body,
            onValueChange = { body = it },
            placeholder = { Text("Paste research, a brief, or competitor copy", color = LuminaraColors.Ink3) },
            shape = RoundedCornerShape(16.dp),
            colors = FoundryFieldColors(),
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("studio_note_input"),
        )
        GhostPillButton(
            text = "Add to sources",
            enabled = body.isNotBlank(),
            onClick = {
                onAdd("", body.trim())
                body = ""
            },
            testTag = "studio_add_note",
        )
    }
}

@Composable
private fun AudioCard(
    state: StudioUiState,
    canGenerate: Boolean,
    onGenerate: () -> Unit,
    onReport: () -> Unit,
) {
    val overview = state.overview
    WorkbenchCard(emphasized = true) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                modifier =
                Modifier
                    .size(44.dp)
                    .background(LuminaraColors.Paper3, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Headphones, contentDescription = null, tint = LuminaraColors.GoldAccent)
            }
            Column {
                EyebrowKicker("Audio overview")
                Text(text = "Two hosts, on-device voices", style = LuminaraTextStyles.Body.copy(fontSize = 12.sp))
            }
        }
        if (overview == null) {
            Text(text = "A short briefing you can play on the go.", style = LuminaraTextStyles.Body)
            FoundryButton(
                text = if (state.isGenerating) "Writing the briefing" else "Generate briefing",
                onClick = onGenerate,
                enabled = canGenerate && !state.isGenerating,
                testTag = "studio_generate_audio",
            )
        } else {
            Text(text = overview.title, style = LuminaraTextStyles.HeadlineSerif.copy(color = LuminaraColors.GoldLight))
            Text(text = overview.summary, style = LuminaraTextStyles.Body)
            AudioPlayer(script = overview.script)
            GhostPillButton(text = "New take", onClick = onGenerate, enabled = !state.isGenerating)
            ReportAiOutput(reported = state.overviewReported, onReport = onReport)
        }
    }
}

/** Owns one on-device speech engine. Callbacks arrive on engine threads, so they carry the turn index. */
private class Narrator(
    context: Context,
    private val onTurnDone: (Int) -> Unit,
    private val onUnavailable: () -> Unit,
) {
    private val lock = Any()
    private var ready = false
    private var pending: (() -> Unit)? = null
    private var engine: TextToSpeech? = null

    init {
        engine =
            TextToSpeech(context.applicationContext) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    engine?.language = Locale.getDefault()
                    engine?.setOnUtteranceProgressListener(
                        object : UtteranceProgressListener() {
                            override fun onStart(utteranceId: String?) = Unit

                            override fun onDone(utteranceId: String?) = finish(utteranceId)

                            @Deprecated("Required override")
                            override fun onError(utteranceId: String?) = finish(utteranceId)
                        },
                    )
                    val queued =
                        synchronized(lock) {
                            ready = true
                            pending.also { pending = null }
                        }
                    queued?.invoke()
                } else {
                    onUnavailable()
                }
            }
    }

    private fun finish(utteranceId: String?) {
        utteranceId?.toIntOrNull()?.let(onTurnDone)
    }

    fun speak(
        index: Int,
        turn: AudioOverviewTurn,
        rate: Float,
    ) {
        val say = {
            engine?.setPitch(if (turn.speaker == "Sam") 0.82f else 1.08f)
            engine?.setSpeechRate(rate)
            val text = turn.text.take(TextToSpeech.getMaxSpeechInputLength() - 1)
            val queued = engine?.speak(text, TextToSpeech.QUEUE_FLUSH, null, index.toString())
            if (queued != TextToSpeech.SUCCESS) onTurnDone(index)
        }
        val runNow =
            synchronized(lock) {
                if (!ready) pending = say
                ready
            }
        if (runNow) say()
    }

    fun stop() {
        synchronized(lock) { pending = null }
        engine?.stop()
    }

    fun shutdown() {
        stop()
        engine?.shutdown()
    }
}

@Composable
private fun AudioPlayer(script: List<AudioOverviewTurn>) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    var index by remember(script) { mutableIntStateOf(0) }
    var playing by remember(script) { mutableStateOf(false) }
    var unavailable by remember(script) { mutableStateOf(false) }
    var rate by remember { mutableFloatStateOf(1f) }
    val narrator =
        remember(script) {
            lateinit var self: Narrator
            self =
                Narrator(
                    context = context,
                    onTurnDone = { finished ->
                        scope.launch {
                            // A flushed turn also reports done. Only the turn on air may advance.
                            if (playing && finished == index) {
                                if (index < script.lastIndex) {
                                    index += 1
                                    self.speak(index, script[index], rate)
                                } else {
                                    playing = false
                                    index = 0
                                }
                            }
                        }
                    },
                    onUnavailable = {
                        scope.launch {
                            playing = false
                            unavailable = true
                        }
                    },
                )
            self
        }
    DisposableEffect(narrator, lifecycleOwner) {
        val observer =
            LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_STOP) {
                    narrator.stop()
                    playing = false
                }
            }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            narrator.shutdown()
        }
    }

    if (unavailable) {
        Text(
            text = "This phone has no speech engine. You can still read the briefing below.",
            style = LuminaraTextStyles.Body,
        )
    }
    Waveform(playing = playing, progress = (index + 1).toFloat() / script.size)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = script.getOrNull(index)?.speaker.orEmpty(),
            style = LuminaraTextStyles.EyebrowMono.copy(fontSize = 13.sp),
        )
        Box(
            modifier =
            Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(LuminaraColors.GoldAccent)
                .clickable(role = Role.Button) {
                    if (playing) {
                        narrator.stop()
                        playing = false
                    } else {
                        playing = true
                        narrator.speak(index, script[index], rate)
                    }
                }.testTag("studio_play_button"),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                contentDescription = if (playing) "Pause" else "Play",
                tint = LuminaraColors.AccentInk,
            )
        }
        GhostPillButton(
            text = "${rate}x",
            onClick = { rate = if (rate >= 1.5f) 1f else rate + 0.25f },
        )
    }
    script.forEachIndexed { turnIndex, turn ->
        val current = turnIndex == index
        Column(
            modifier =
            Modifier
                .fillMaxWidth()
                .background(
                    if (current) LuminaraColors.Paper3 else LuminaraColors.Paper2,
                    RoundedCornerShape(16.dp),
                ).padding(12.dp),
        ) {
            Text(text = turn.speaker, style = LuminaraTextStyles.EyebrowMono)
            Text(
                text = turn.text,
                style =
                LuminaraTextStyles.Body.copy(
                    color = if (current) LuminaraColors.Ink else LuminaraColors.Ink2,
                ),
            )
        }
    }
}

private val WAVE_BARS = listOf(10, 22, 34, 18, 28, 40, 24, 16, 34, 26, 12, 22, 30, 14, 24, 18)

@Composable
private fun Waveform(
    playing: Boolean,
    progress: Float,
) {
    val transition = rememberInfiniteTransition(label = "wave")
    val lift by transition.animateFloat(
        initialValue = 0.7f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(420), RepeatMode.Reverse),
        label = "waveLift",
    )
    Row(
        modifier =
        Modifier
            .fillMaxWidth()
            .height(48.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        WAVE_BARS.forEachIndexed { bar, height ->
            val reached = bar.toFloat() / WAVE_BARS.size < progress
            val scaled = if (playing && bar % 2 == 0) height * lift else height.toFloat()
            Box(modifier = Modifier.fillMaxHeight(), contentAlignment = Alignment.Center) {
                Box(
                    modifier =
                    Modifier
                        .width(4.dp)
                        .height(scaled.dp)
                        .background(
                            if (reached) LuminaraColors.GoldAccent else LuminaraColors.Paper3,
                            CircleShape,
                        ),
                )
            }
        }
    }
}
