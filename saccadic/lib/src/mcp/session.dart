/// Refine session state — tracks iteration history, stall detection, and
/// per-page progress for the refine_build MCP tool.
library;

/// Status of a single page within a refine session.
class RefinePageStatus {
  final String name;
  String status; // 'pending' | 'iterating' | 'passed'
  double score;
  int iterations;

  RefinePageStatus({
    required this.name,
    this.status = 'pending',
    this.score = 0,
    this.iterations = 0,
  });

  Map<String, dynamic> toJson() => {
        'frame': name,
        'status': status,
        'score': '${(score * 100).round()}%',
        'iterations': iterations,
      };
}

/// A single iteration record for history tracking.
class RefineIterationRecord {
  final int iteration;
  final double score;
  final String grade;
  final int failCount;
  final int warnCount;

  const RefineIterationRecord({
    required this.iteration,
    required this.score,
    required this.grade,
    required this.failCount,
    required this.warnCount,
  });

  Map<String, dynamic> toJson() => {
        'iteration': iteration,
        'score': '${(score * 100).round()}%',
        'grade': grade,
      };
}

/// Snapshot of element comparison state for incremental change detection.
class RefineSnapshot {
  final Map<String, String> styleHashes;

  const RefineSnapshot({required this.styleHashes});
}

/// In-memory refine session for a .pen file.
///
/// Tracks per-page progress, iteration history, stall detection,
/// and incremental change tracking between iterations.
class RefineSession {
  final String pencilFile;
  final List<RefinePageStatus> pages;
  String? currentFrame;
  List<RefineIterationRecord> history = [];
  RefineSnapshot? previousSnapshot;
  Set<String>? changedElements;

  RefineSession({
    required this.pencilFile,
    required this.pages,
    this.currentFrame,
  });

  /// Detect if the score has stalled (< 1% improvement over last 3 iterations).
  bool get isStalled {
    if (history.length < 3) return false;
    final recent = history.sublist(history.length - 3);
    final improvement = recent.last.score - recent.first.score;
    return improvement < 0.01;
  }

  /// Detect if the score is oscillating (going up and down alternately).
  bool get isOscillating {
    if (history.length < 4) return false;
    final recent = history.sublist(history.length - 4);
    final diffs = <double>[];
    for (var i = 1; i < recent.length; i++) {
      diffs.add(recent[i].score - recent[i - 1].score);
    }
    return diffs.any((d) => d > 0) && diffs.any((d) => d < 0);
  }

  /// Record a new iteration and update page status.
  void recordIteration({
    required int iteration,
    required double score,
    required String grade,
    required int failCount,
    required int warnCount,
  }) {
    history.add(RefineIterationRecord(
      iteration: iteration,
      score: score,
      grade: grade,
      failCount: failCount,
      warnCount: warnCount,
    ),);

    if (currentFrame != null) {
      final page = pages.where((p) => p.name == currentFrame).firstOrNull;
      if (page != null) {
        page.score = score;
        page.iterations = iteration;
      }
    }
  }

  /// Switch to a new frame, resetting iteration history.
  void switchFrame(String frame) {
    if (frame != currentFrame) {
      history = [];
      previousSnapshot = null;
      changedElements = null;
      currentFrame = frame;

      final page = pages.where((p) => p.name == frame).firstOrNull;
      if (page != null) page.status = 'iterating';
    }
  }

  /// Mark the current frame as passed and find the next pending page.
  String? markPassedAndGetNext() {
    if (currentFrame != null) {
      final page = pages.where((p) => p.name == currentFrame).firstOrNull;
      if (page != null) page.status = 'passed';
    }
    return pages.where((p) => p.status == 'pending').firstOrNull?.name;
  }

  /// Update the incremental change snapshot and identify changed elements.
  void updateSnapshot(Map<String, String> currentHashes) {
    if (previousSnapshot != null) {
      final changed = <String>{};
      for (final entry in currentHashes.entries) {
        final prevHash = previousSnapshot!.styleHashes[entry.key];
        if (prevHash != entry.value) changed.add(entry.key);
      }
      for (final el in previousSnapshot!.styleHashes.keys) {
        if (!currentHashes.containsKey(el)) changed.add(el);
      }
      changedElements = changed;
    }
    previousSnapshot = RefineSnapshot(styleHashes: currentHashes);
  }

  /// Generate a stall-breaking strategy based on remaining issue categories.
  String generateStallStrategy({
    required double matchPercentage,
    required Map<String, int> remainingCategories,
    required int totalRemaining,
  }) {
    if (isOscillating) {
      return 'Score is oscillating — recent changes may be conflicting. '
          'Revert the last change and try a different approach.';
    }

    final pixelOnlyIssues = remainingCategories['rendering'] ?? 0;
    final positionSizeIssues =
        (remainingCategories['layout'] ?? 0) + (remainingCategories['size'] ?? 0);
    final missingExtraIssues =
        (remainingCategories['missing'] ?? 0) + (remainingCategories['extra'] ?? 0);

    if (totalRemaining > 0 && pixelOnlyIssues / totalRemaining > 0.6) {
      return 'Mostly pixel-level differences with clean widget tree — '
          'focus on visual polish: shadows, gradients, border anti-aliasing, font rendering.';
    }
    if (totalRemaining > 0 && positionSizeIssues / totalRemaining > 0.6) {
      return 'Mostly position/size issues — check parent layout mode '
          '(Row vs Column vs Stack), container sizing, and overflow behavior.';
    }
    if (totalRemaining > 0 && missingExtraIssues / totalRemaining > 0.5) {
      return 'Many missing/extra widgets — the widget structure may need '
          'rebuilding rather than property adjustments.';
    }
    if (matchPercentage < 0.8) {
      return 'Score below 80% and stalled — consider broader structural '
          'changes instead of incremental property fixes.';
    }
    return 'Score stalled — try broader structural changes instead '
        'of incremental fixes.';
  }
}
