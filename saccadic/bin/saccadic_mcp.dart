import 'dart:io';

import 'package:saccadic/src/mcp/server.dart';

void main() async {
  final server = SaccadicMcpServer();

  // Handle termination signals
  ProcessSignal.sigint.watch().listen((_) async {
    await server.close();
    exit(0);
  });
  ProcessSignal.sigterm.watch().listen((_) async {
    await server.close();
    exit(0);
  });

  await server.start();
}
