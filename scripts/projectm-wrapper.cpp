// SpectraViz / WaveScope web wrapper for libprojectM (v4).
//
// Exposes a tiny C ABI to JavaScript: create a WebGL2 context on the page's
// canvas, spin up a projectM instance, feed it PCM, load raw .milk presets by
// their text, and render frames. Linked against the static WASM archives of
// libprojectM + projectM-eval (the ns-eel expression VM that runs preset
// equations) + glad. See ROADMAP-V2.md for the pipeline.

#include <emscripten.h>
#include <emscripten/html5.h>
#include <emscripten/html5_webgl.h>

#include <projectM-4/projectM.h>
#include <projectM-4/callbacks.h>
#include <string>
#include <exception>
#include <cmath>
#include <projectM-4/core.h>
#include <projectM-4/audio.h>
#include <projectM-4/parameters.h>
#include <projectM-4/render_opengl.h>

// ABI 2: checked loads and caller-selected transition length.
static std::string g_error;
static void preset_failed(const char*, const char* message, void*) {
    g_error = message ? message : "Preset rejected by projectM.";
}
static projectm_handle g_pm = nullptr;
static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE g_ctx = 0;

extern "C" {

// Create the WebGL2 context on the canvas selected by `#canvas` and start a
// projectM instance. Returns 0 on success, non-zero error code otherwise.
EMSCRIPTEN_KEEPALIVE
int sv_init(int width, int height, int meshX, int meshY) {
    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
    attrs.majorVersion = 2; // WebGL2 -> OpenGL ES 3.0 emulation
    attrs.minorVersion = 0;
    attrs.alpha = EM_FALSE;
    attrs.depth = EM_TRUE;
    attrs.stencil = EM_FALSE;
    attrs.antialias = EM_FALSE;
    attrs.preserveDrawingBuffer = EM_FALSE;
    attrs.powerPreference = EM_WEBGL_POWER_PREFERENCE_HIGH_PERFORMANCE;
    attrs.failIfMajorPerformanceCaveat = EM_FALSE;

    g_ctx = emscripten_webgl_create_context("#canvas", &attrs);
    if (g_ctx <= 0) return 1;
    if (emscripten_webgl_make_context_current(g_ctx) != EMSCRIPTEN_RESULT_SUCCESS)
        return 2;

    // Required by projectM's motion-vector grid (float textures).
    emscripten_webgl_enable_extension(g_ctx, "OES_texture_float");
    emscripten_webgl_enable_extension(g_ctx, "OES_texture_float_linear");
    emscripten_webgl_enable_extension(g_ctx, "EXT_color_buffer_float");

    g_pm = projectm_create();
    if (!g_pm) return 3;

    projectm_set_preset_switch_failed_event_callback(g_pm, preset_failed, nullptr);
    projectm_set_preset_locked(g_pm, true);
    projectm_set_hard_cut_enabled(g_pm, false);
    projectm_set_window_size(g_pm, (size_t)width, (size_t)height);
    projectm_set_mesh_size(g_pm, (size_t)(meshX > 0 ? meshX : 48),
                           (size_t)(meshY > 0 ? meshY : 32));
    projectm_set_fps(g_pm, 60);
    projectm_set_preset_duration(g_pm, 30.0);
    projectm_set_soft_cut_duration(g_pm, 2.7);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void sv_resize(int width, int height) {
    if (g_pm) { emscripten_webgl_make_context_current(g_ctx); projectm_set_window_size(g_pm, (size_t)width, (size_t)height); }
}

// Load a preset from its raw .milk text (works for bundled + user uploads).
EMSCRIPTEN_KEEPALIVE
int sv_load_preset_data(const char* data, double seconds) {
    g_error.clear();
    if (!g_pm || !data || !std::isfinite(seconds) || seconds < 0.0 || seconds > 10.0) {
        g_error = "Invalid preset load or engine unavailable.";
        return 1;
    }
    emscripten_webgl_make_context_current(g_ctx);
    try {
        projectm_set_soft_cut_duration(g_pm, seconds > 0.0 ? seconds : 2.7);
        projectm_load_preset_data(g_pm, data, seconds > 0.0);
    } catch (const std::exception& error) {
        g_error = error.what();
    } catch (...) {
        g_error = "Preset load failed.";
    }
    return g_error.empty() ? 0 : 1;
}

EMSCRIPTEN_KEEPALIVE
const char* sv_last_error() { return g_error.c_str(); }

// count = samples per channel; interleaved stereo when channels == 2.
EMSCRIPTEN_KEEPALIVE
void sv_add_pcm_float(const float* samples, int count, int channels) {
    if (!g_pm || !samples) return;
    projectm_pcm_add_float(g_pm, samples, (unsigned int)count,
                           channels == 2 ? PROJECTM_STEREO : PROJECTM_MONO);
}

EMSCRIPTEN_KEEPALIVE
unsigned int sv_max_samples() {
    return projectm_pcm_get_max_samples();
}

EMSCRIPTEN_KEEPALIVE
void sv_render() {
    if (!g_pm) return;
    emscripten_webgl_make_context_current(g_ctx);
    projectm_opengl_render_frame(g_pm);
}

EMSCRIPTEN_KEEPALIVE
void sv_destroy() {
    if (g_pm) {
        emscripten_webgl_make_context_current(g_ctx);
        projectm_destroy(g_pm);
        g_pm = nullptr;
    }
    if (g_ctx > 0) {
        emscripten_webgl_destroy_context(g_ctx);
        g_ctx = 0;
    }
}

} // extern "C"

// Keeps the Emscripten runtime resident so the exported functions stay callable.
int main() { return 0; }
