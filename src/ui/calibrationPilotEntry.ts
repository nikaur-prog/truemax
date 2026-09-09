// A separate entry keeps account, attribution, history UI and upload boot out
// of the diagnostic module graph. This HTML is not a production build input.
if (import.meta.env.DEV) {
  void import("./calibrationPilot.js").then(({ mountCalibrationPilot }) => {
    mountCalibrationPilot(document.getElementById("pilot")!);
  }).catch((error: unknown) => {
    document.getElementById("pilot")!.textContent = `Diagnostic failed to load: ${String(error)}`;
  });
}
