import { useEffect, useReducer, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useAnimatedValue,
  useWindowDimensions,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { createGame, gameReducer, getOutcome } from '../game/logic';
import type { Player } from '../game/logic';

// Local two-player game. Scores last until this screen is unmounted.
const COLORS = {
  X: '#8EEAE0',
  O: '#FFBCAC',
  ink: '#F4F6FC',
  muted: '#AAB8CE',
};

const FILL: ViewStyle = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 };

function useAccessibilityPreferences() {
  // Stay conservative until the device's preferences have been read.
  const [preferences, setPreferences] = useState({
    reduceMotion: true,
    reduceTransparency:
      typeof AccessibilityInfo.isReduceTransparencyEnabled === 'function' || Platform.OS === 'web',
  });

  useEffect(() => {
    let mounted = true;
    let motionEventReceived = false;
    let transparencyEventReceived = false;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      motionEventReceived = true;
      setPreferences((previous) => ({ ...previous, reduceMotion: value }));
    });
    const canQueryTransparency = typeof AccessibilityInfo.isReduceTransparencyEnabled === 'function';
    const transparency = canQueryTransparency
      ? AccessibilityInfo.addEventListener('reduceTransparencyChanged', (value) => {
        transparencyEventReceived = true;
        setPreferences((previous) => ({ ...previous, reduceTransparency: value }));
      })
      : null;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted && !motionEventReceived) {
        setPreferences((previous) => ({ ...previous, reduceMotion: value }));
      }
    }).catch(() => {});
    let removeWebTransparency: (() => void) | undefined;
    if (canQueryTransparency) {
      void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
        if (mounted && !transparencyEventReceived) {
          setPreferences((previous) => ({ ...previous, reduceTransparency: value }));
        }
      }).catch(() => {});
    } else if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const media = window.matchMedia('(prefers-reduced-transparency: reduce)');
      const update = () => setPreferences((previous) => ({ ...previous, reduceTransparency: media.matches }));
      update();
      media.addEventListener('change', update);
      removeWebTransparency = () => media.removeEventListener('change', update);
    }
    return () => {
      mounted = false;
      motion?.remove();
      transparency?.remove();
      removeWebTransparency?.();
    };
  }, []);

  return preferences;
}

type GlassMode = 'native' | 'blur' | 'solid';
type GlassPanelProps = PropsWithChildren<{
  mode: GlassMode;
  style?: StyleProp<ViewStyle>;
  interactive?: boolean;
}>;

function GlassPanel({ mode, style, interactive = false, children }: GlassPanelProps) {
  const content = (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.015)', 'rgba(255,255,255,0.055)']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={FILL}
      />
      {children}
    </>
  );

  if (mode === 'native') {
    return (
      <GlassView
        glassEffectStyle="regular"
        colorScheme="dark"
        tintColor="rgba(20,35,57,0.18)"
        isInteractive={interactive}
        style={[styles.panel, style]}
      >
        {content}
      </GlassView>
    );
  }

  return (
    <View style={[styles.panel, mode === 'solid' && styles.solidPanel, style]}>
      {mode === 'blur' && (
        <BlurView pointerEvents="none" intensity={45} tint="dark" style={FILL} />
      )}
      {content}
    </View>
  );
}

function Mark({
  player,
  size = 28,
  animate = false,
  reduceMotion = false,
}: {
  player: Player;
  size?: number;
  animate?: boolean;
  reduceMotion?: boolean;
}) {
  const progress = useAnimatedValue(animate && !reduceMotion ? 0 : 1);
  useEffect(() => {
    if (!animate || reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.spring(progress, {
      toValue: 1,
      stiffness: 240,
      damping: 18,
      mass: 0.7,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, reduceMotion, progress]);

  const stroke = Math.max(3, size * 0.105);
  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1], extrapolate: 'clamp' }),
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
      }}
    >
      {player === 'O' ? (
        <View style={{
          position: 'absolute',
          top: size * 0.025,
          left: size * 0.025,
          width: size * 0.95,
          height: size * 0.95,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: COLORS.O,
        }} />
      ) : (
        [45, -45].map((angle) => (
          <View key={angle} style={{
            position: 'absolute',
            top: (size - stroke) / 2,
            left: 0,
            width: size,
            height: stroke,
            borderRadius: stroke / 2,
            backgroundColor: COLORS.X,
            transform: [{ rotate: `${angle}deg` }],
          }} />
        ))
      )}
    </Animated.View>
  );
}

async function feedback(kind: 'move' | 'win' | 'draw' | 'reset') {
  if (Platform.OS === 'web') return;
  try {
    if (kind === 'win') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (kind === 'draw') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    } else if (kind === 'reset') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      await Haptics.selectionAsync();
    }
  } catch {
    // Feedback is optional; unavailable hardware must never interrupt a game.
  }
}

function scoreLabel(label: string, value: number) {
  return `${label}: ${value}`;
}

export default function HomeScreen() {
  const [game, dispatch] = useReducer(gameReducer, undefined, () => createGame());
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [showReset, setShowReset] = useState(false);
  const preferences = useAccessibilityPreferences();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [nativeGlassAvailable] = useState(() => (
    Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable()
  ));

  const mode: GlassMode = preferences.reduceTransparency
    ? 'solid'
    : nativeGlassAvailable
      ? 'native'
      : Platform.OS === 'ios' || Platform.OS === 'web'
        ? 'blur'
        : 'solid';

  const usableHeight = height - insets.top - insets.bottom;
  const compact = usableHeight < 800;
  const boardSize = Math.max(0, Math.min(
    380,
    width - insets.left - insets.right - 36,
    Math.max(228, usableHeight - (compact ? 390 : 470)),
  ));
  const markSize = Math.min(56, ((boardSize - 44) / 3) * 0.53);
  const moves = game.board.filter((cell) => cell !== null).length;
  const outcome = getOutcome(game.board);
  const finished = outcome.kind !== 'playing';
  const accent = outcome.kind === 'win' ? COLORS[outcome.winner] : COLORS[game.turn];
  const status = outcome.kind === 'win'
    ? `Player ${outcome.winner} wins!`
    : outcome.kind === 'draw'
      ? "It's a draw!"
      : `Player ${game.turn}'s turn`;

  // Compare committed states, not event-handler closures, for feedback.
  const previousGame = useRef(game);
  useEffect(() => {
    const previous = previousGame.current;
    previousGame.current = game;
    if (previous === game) return;
    const currentResult = getOutcome(game.board);
    if (hapticsEnabled) {
      void feedback(
        previous.roundId !== game.roundId ? 'reset' :
          currentResult.kind === 'win' ? 'win' :
            currentResult.kind === 'draw' ? 'draw' : 'move',
      );
    }
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(status);
    }
  }, [game, hapticsEnabled, status]);

  const roundHasMoves = moves > 0;
  const hasScores = game.scores.X + game.scores.O + game.scores.draws > 0;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <View pointerEvents="none" style={styles.background}>
        <LinearGradient colors={['#0B1627', '#172B3D', '#1D2036']} style={FILL} />
        <LinearGradient
          colors={['rgba(113,231,215,0)', 'rgba(113,231,215,0.28)', 'rgba(113,231,215,0)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.ribbon, styles.mintRibbon]}
        />
        <LinearGradient
          colors={['rgba(164,140,255,0)', 'rgba(164,140,255,0.25)', 'rgba(164,140,255,0)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.ribbon, styles.violetRibbon]}
        />
        <LinearGradient
          colors={['rgba(255,183,159,0)', 'rgba(255,183,159,0.19)', 'rgba(255,183,159,0)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.ribbon, styles.peachRibbon]}
        />
        <LinearGradient
          colors={['rgba(8,16,30,0.05)', 'rgba(8,16,30,0.38)']}
          style={FILL}
        />
      </View>

      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, compact && styles.compactContent]}
        >
          <View style={{ width: boardSize }}>
            <View style={styles.topBar}>
              <View style={styles.brand} accessible accessibilityLabel="XO, local two-player game">
                <Mark player="X" size={21} />
                <Mark player="O" size={21} />
                <View style={styles.brandDivider} />
                <Text style={styles.brandLabel}>PASS & PLAY</Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="Haptic feedback"
                accessibilityState={{ checked: hapticsEnabled }}
                onPress={() => setHapticsEnabled((value) => !value)}
                style={({ pressed }) => [styles.hapticToggle, pressed && styles.smallPressed]}
              >
                <View style={[styles.smallDot, { backgroundColor: hapticsEnabled ? COLORS.X : '#68778E' }]} />
                <Text style={styles.hapticLabel}>Haptics {hapticsEnabled ? 'on' : 'off'}</Text>
              </Pressable>
            </View>

            <View style={[styles.heading, compact && styles.compactHeading]}>
              <Text accessibilityRole="header" style={[styles.title, compact && styles.compactTitle]}>A little rivalry.</Text>
              {!compact && <Text style={styles.subtitle}>One phone. Two players. Your next move.</Text>}
            </View>

            <View style={styles.scores}>
              {(['X', 'draws', 'O'] as const).map((key) => {
                const active = outcome.kind === 'playing' && key === game.turn;
                const label = key === 'draws' ? 'Draws' : `Player ${key}`;
                return (
                  <View key={key} style={styles.scoreColumn}>
                    <GlassPanel mode={mode} style={[
                      styles.scoreCard,
                      compact && styles.compactScoreCard,
                      active && { borderColor: COLORS[game.turn] },
                    ]}>
                      <View style={styles.scoreTop}>
                        <Text style={[styles.scoreLabel, active && { color: accent }]}>{label}</Text>
                        {active && <View style={[styles.activeDot, { backgroundColor: accent }]} />}
                      </View>
                      <Text testID={`score-${key}`} accessibilityLabel={scoreLabel(label, game.scores[key])} style={styles.scoreValue}>
                        {game.scores[key]}
                      </Text>
                    </GlassPanel>
                  </View>
                );
              })}
            </View>

            <View style={styles.statusRow}>
              <View style={styles.statusTextGroup}>
                <Text testID="game-status" accessibilityLiveRegion="polite" style={[styles.status, finished && { color: outcome.kind === 'win' ? accent : COLORS.ink }]}>
                  {status}
                </Text>
                <Text style={styles.statusHint}>{finished ? 'Ready for a rematch?' : 'Tap an empty tile.'}</Text>
              </View>
              <View style={styles.moveDots} accessible accessibilityLabel={`${moves} of 9 tiles filled`}>
                {Array.from({ length: 9 }, (_, index) => (
                  <View key={index} style={[styles.moveDot, index < moves && { backgroundColor: accent }]} />
                ))}
              </View>
            </View>

            <View style={[styles.boardShadow, { width: boardSize, height: boardSize }]}>
              <GlassPanel mode={mode} style={styles.board}>
                {[0, 1, 2].map((row) => (
                  <View key={row} style={styles.boardRow}>
                    {[0, 1, 2].map((column) => {
                      const index = row * 3 + column;
                      const cell = game.board[index];
                      const winning = outcome.kind === 'win' && outcome.line.includes(index);
                      const disabled = cell !== null || finished;
                      return (
                        <Pressable
                          key={index}
                          testID={`cell-${index}`}
                          accessibilityRole="button"
                          accessibilityState={{ disabled }}
                          accessibilityLabel={`Row ${row + 1}, column ${column + 1}, ${cell ?? 'empty'}${winning ? ', winning tile' : ''}`}
                          disabled={disabled}
                          onPress={() => dispatch({ type: 'play', index, expectedTurn: game.turn, roundId: game.roundId })}
                          style={({ pressed }) => [
                            styles.cell,
                            preferences.reduceTransparency && styles.solidCell,
                            cell === 'X' && styles.xCell,
                            cell === 'O' && styles.oCell,
                            winning && { borderColor: accent, backgroundColor: outcome.kind === 'win' && outcome.winner === 'X' ? '#214745' : '#493B3D' },
                            pressed && styles.cellPressed,
                          ]}
                        >
                          <LinearGradient
                            pointerEvents="none"
                            colors={['rgba(255,255,255,0.065)', 'rgba(255,255,255,0)']}
                            style={FILL}
                          />
                          {cell && <Mark player={cell} size={markSize} animate reduceMotion={preferences.reduceMotion} />}
                          {winning && <Text accessible={false} style={[styles.winningLabel, { color: accent }]}>WIN</Text>}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </GlassPanel>
            </View>

            <View style={styles.roundRow}>
              <Text style={styles.roundLabel}>ROUND {String(game.round).padStart(2, '0')}</Text>
              <Text style={styles.roundHint}>{finished ? 'Round complete' : `${game.starter} starts this round`}</Text>
            </View>

            <Pressable
              testID="round-action"
              accessibilityRole="button"
              accessibilityState={{ disabled: !roundHasMoves }}
              accessibilityLabel={finished ? 'Start next round' : 'Restart this round'}
              disabled={!roundHasMoves}
              onPress={() => dispatch({ type: finished ? 'next' : 'restart', roundId: game.roundId })}
              style={({ pressed }) => [styles.primaryPressable, pressed && !preferences.reduceMotion && styles.buttonPressed]}
            >
              <GlassPanel mode={mode} interactive style={[styles.primaryButton, !roundHasMoves && styles.disabledButton]}>
                <Text style={[styles.restartIcon, !roundHasMoves && styles.disabledText]}>{finished ? '→' : '↻'}</Text>
                <Text style={[styles.primaryText, !roundHasMoves && styles.disabledText]}>{finished ? 'Next round' : 'Restart round'}</Text>
              </GlassPanel>
            </Pressable>

            <Pressable
              testID="reset-match"
              accessibilityRole="button"
              accessibilityState={{ disabled: !roundHasMoves && !hasScores }}
              disabled={!roundHasMoves && !hasScores}
              onPress={() => setShowReset(true)}
              style={({ pressed }) => [styles.resetButton, pressed && styles.smallPressed]}
            >
              <Text style={styles.resetText}>Reset match & scores</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={showReset}
        transparent
        animationType="none"
        onRequestClose={() => setShowReset(false)}
        onShow={() => AccessibilityInfo.announceForAccessibility('Reset match? All scores will return to zero.')}
      >
        <View style={styles.modalCenter}>
          <Pressable
            style={styles.modalBackdrop}
            accessibilityRole="button"
            accessibilityLabel="Cancel reset"
            onPress={() => setShowReset(false)}
          />
          <View accessibilityViewIsModal style={{ width: Math.min(344, width - 40) }}>
            <GlassPanel mode={mode} style={styles.dialog}>
              <Text accessibilityRole="header" style={styles.dialogTitle}>Fresh start?</Text>
              <Text style={styles.dialogDescription}>Clear the board and all scores? This cannot be undone.</Text>
              <View style={styles.dialogActions}>
                <Pressable testID="cancel-reset" accessibilityRole="button" onPress={() => setShowReset(false)} style={styles.dialogCancel}>
                  <Text style={styles.dialogCancelText}>Keep playing</Text>
                </Pressable>
                <Pressable testID="confirm-reset" accessibilityRole="button" onPress={() => { dispatch({ type: 'reset' }); setShowReset(false); }} style={styles.dialogReset}>
                  <Text style={styles.dialogResetText}>Reset match</Text>
                </Pressable>
              </View>
            </GlassPanel>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B1627' },
  safeArea: { flex: 1 },
  background: { ...FILL, overflow: 'hidden' },
  ribbon: { position: 'absolute', width: 660, height: 340, borderRadius: 300 },
  mintRibbon: { left: -340, top: '24%', transform: [{ rotate: '-38deg' }] },
  violetRibbon: { right: -390, top: '-4%', transform: [{ rotate: '35deg' }] },
  peachRibbon: { right: -300, bottom: '-8%', transform: [{ rotate: '-30deg' }] },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 18 },
  compactContent: { paddingVertical: 8 },
  topBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandDivider: { width: 1, height: 19, marginHorizontal: 5, backgroundColor: 'rgba(255,255,255,0.17)' },
  brandLabel: { color: COLORS.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.1 },
  hapticToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 2 },
  smallDot: { width: 5, height: 5, borderRadius: 3 },
  hapticLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '600' },
  smallPressed: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12 },
  heading: { marginTop: 6, marginBottom: 22 },
  compactHeading: { marginTop: 2, marginBottom: 14 },
  title: { color: COLORS.ink, fontSize: 36, fontWeight: '700', letterSpacing: -1.3 },
  compactTitle: { fontSize: 30 },
  subtitle: { color: COLORS.muted, fontSize: 13, marginTop: 7, lineHeight: 19 },
  panel: { overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(236,244,255,0.2)', backgroundColor: 'rgba(11,23,41,0.24)' },
  solidPanel: { backgroundColor: '#1C2C42' },
  scores: { flexDirection: 'row', gap: 9 },
  scoreColumn: { flex: 1, minWidth: 0 },
  scoreCard: { minHeight: 78, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 20 },
  compactScoreCard: { minHeight: 66, paddingVertical: 9, paddingHorizontal: 10 },
  scoreTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 3 },
  scoreLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '600' },
  activeDot: { width: 4, height: 4, borderRadius: 2 },
  scoreValue: { color: COLORS.ink, fontSize: 27, lineHeight: 33, fontWeight: '600', fontVariant: ['tabular-nums'], marginTop: 3 },
  statusRow: { minHeight: 65, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 2, paddingVertical: 12 },
  statusTextGroup: { flex: 1 },
  status: { color: COLORS.ink, fontSize: 16, fontWeight: '600', lineHeight: 21 },
  statusHint: { color: COLORS.muted, fontSize: 11, marginTop: 3, lineHeight: 15 },
  moveDots: { flexDirection: 'row', gap: 3 },
  moveDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  boardShadow: { borderRadius: 32, shadowColor: '#000000', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.22, shadowRadius: 24, elevation: 8 },
  board: { flex: 1, borderRadius: 32, padding: 12, gap: 9 },
  boardRow: { flex: 1, flexDirection: 'row', gap: 9 },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(239,247,255,0.11)', backgroundColor: 'rgba(8,18,33,0.22)', overflow: 'hidden' },
  solidCell: { backgroundColor: '#142135' },
  xCell: { backgroundColor: 'rgba(63,160,150,0.11)' },
  oCell: { backgroundColor: 'rgba(204,136,117,0.12)' },
  cellPressed: { backgroundColor: 'rgba(235,246,255,0.17)' },
  winningLabel: { position: 'absolute', bottom: 6, fontSize: 8, fontWeight: '700', letterSpacing: 2 },
  roundRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3, gap: 8 },
  roundLabel: { color: COLORS.muted, fontSize: 9, letterSpacing: 1.8, fontWeight: '700' },
  roundHint: { color: COLORS.muted, fontSize: 10 },
  primaryPressable: { borderRadius: 24 },
  buttonPressed: { transform: [{ scale: 0.98 }] },
  primaryButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, borderColor: 'rgba(210,250,245,0.35)', backgroundColor: 'rgba(113,231,215,0.075)' },
  disabledButton: { borderColor: 'rgba(236,244,255,0.15)' },
  restartIcon: { color: COLORS.ink, fontSize: 24, lineHeight: 28 },
  primaryText: { color: COLORS.ink, fontSize: 15, fontWeight: '600' },
  disabledText: { color: '#90A0B6' },
  resetButton: { alignSelf: 'center', minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 3 },
  resetText: { color: COLORS.muted, fontSize: 11, fontWeight: '500' },
  modalCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalBackdrop: { ...FILL, backgroundColor: 'rgba(4,9,18,0.78)' },
  dialog: { padding: 24, borderRadius: 30, backgroundColor: '#18263C' },
  dialogTitle: { color: COLORS.ink, fontSize: 25, fontWeight: '700', letterSpacing: -0.6 },
  dialogDescription: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginTop: 9, marginBottom: 22 },
  dialogActions: { gap: 10 },
  dialogCancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', padding: 10 },
  dialogCancelText: { color: COLORS.ink, fontSize: 14, fontWeight: '600' },
  dialogReset: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: COLORS.O, padding: 10 },
  dialogResetText: { color: '#322022', fontSize: 14, fontWeight: '700' },
});
