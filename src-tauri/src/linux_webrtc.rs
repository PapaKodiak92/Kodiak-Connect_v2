use serde::{Deserialize, Serialize};
use tauri::AppHandle;
#[cfg(target_os = "linux")]
use gstreamer as gst;
#[cfg(target_os = "linux")]
use gstreamer_sdp as gst_sdp;
#[cfg(target_os = "linux")]
use gstreamer_webrtc as gst_webrtc;

#[cfg(target_os = "linux")]
use gst::prelude::*;
#[cfg(target_os = "linux")]
use once_cell::sync::Lazy;
#[cfg(target_os = "linux")]
use std::{
    collections::HashMap,
    sync::{mpsc, Mutex},
    time::Duration,
};
#[cfg(target_os = "linux")]
use tauri::Emitter;

#[cfg(target_os = "linux")]
static GST_READY: Lazy<()> = Lazy::new(|| {
    gst::init().expect("Kodiak Connect failed to initialize GStreamer");
});

#[cfg(target_os = "linux")]
static LINUX_RTC_PEERS: Lazy<Mutex<HashMap<String, LinuxRtcPeer>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Serialize)]
pub struct LinuxRtcIceCandidate {
    pub call_id: String,
    pub candidate: String,
    pub sdp_m_line_index: u32,
}

#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Deserialize)]
pub struct LinuxRtcIceCandidateInput {
    pub candidate: String,
    #[serde(rename = "sdpMLineIndex")]
    pub sdp_m_line_index: Option<u32>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxRtcDiagnostics {
    pub available: bool,
    pub reason: Option<String>,
    pub missing_plugins: Vec<String>,
}

#[cfg(target_os = "linux")]
struct LinuxRtcPeer {
    pipeline: gst::Pipeline,
    webrtc: gst::Element,
}

#[cfg(target_os = "linux")]
fn required_linux_rtc_plugins() -> [&'static str; 12] {
    [
        "webrtcbin",
        "autoaudiosrc",
        "audioconvert",
        "audioresample",
        "volume",
        "opusenc",
        "rtpopuspay",
        "capsfilter",
        "queue",
        "rtpopusdepay",
        "opusdec",
        "autoaudiosink",
    ]
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn kodiak_linux_rtc_diagnostics() -> LinuxRtcDiagnostics {
    if let Err(error) = gst::init() {
        return LinuxRtcDiagnostics {
            available: false,
            reason: Some(format!("GStreamer initialization failed: {error}")),
            missing_plugins: vec![],
        };
    }

    let missing_plugins = required_linux_rtc_plugins()
        .iter()
        .filter(|plugin| gst::ElementFactory::find(plugin).is_none())
        .map(|plugin| plugin.to_string())
        .collect::<Vec<_>>();

    if !missing_plugins.is_empty() {
        return LinuxRtcDiagnostics {
            available: false,
            reason: Some(format!(
                "Linux native RTC is missing required GStreamer plugins: {}",
                missing_plugins.join(", ")
            )),
            missing_plugins,
        };
    }

    LinuxRtcDiagnostics {
        available: true,
        reason: None,
        missing_plugins: vec![],
    }
}
#[cfg(target_os = "linux")]
fn gst_error(error: impl ToString) -> String {
    error.to_string()
}

#[cfg(target_os = "linux")]
fn parse_sdp(sdp: &str, sdp_type: gst_webrtc::WebRTCSDPType) -> Result<gst_webrtc::WebRTCSessionDescription, String> {
    let message = gst_sdp::SDPMessage::parse_buffer(sdp.as_bytes()).map_err(gst_error)?;
    Ok(gst_webrtc::WebRTCSessionDescription::new(sdp_type, message))
}

#[cfg(target_os = "linux")]
fn session_description_to_sdp(description: &gst_webrtc::WebRTCSessionDescription) -> Result<String, String> {
    description.sdp().as_text().map(|value| value.to_string()).map_err(gst_error)
}

#[cfg(target_os = "linux")]
fn wait_for_description(
    receiver: mpsc::Receiver<Result<gst_webrtc::WebRTCSessionDescription, String>>,
    label: &str,
) -> Result<gst_webrtc::WebRTCSessionDescription, String> {
    receiver
        .recv_timeout(Duration::from_secs(8))
        .map_err(|_| format!("Timed out waiting for Linux native WebRTC {label}."))?
}

#[cfg(target_os = "linux")]
fn build_opus_rtp_caps() -> gst::Caps {
    gst::Caps::builder("application/x-rtp")
        .field("media", "audio")
        .field("encoding-name", "OPUS")
        .field("payload", 96i32)
        .field("clock-rate", 48000i32)
        .build()
}

#[cfg(target_os = "linux")]
fn request_webrtc_audio_sink_pad(webrtc: &gst::Element, caps: &gst::Caps) -> Result<gst::Pad, String> {
    let templates = webrtc.pad_template_list();

    for template in &templates {
        if template.direction() == gst::PadDirection::Sink && template.presence() == gst::PadPresence::Request {
            if let Some(pad) = webrtc.request_pad(template, None::<&str>, Some(caps)) {
                return Ok(pad);
            }
        }
    }

    let template_names = templates
        .iter()
        .map(|template| {
            format!(
                "{}:{:?}:{:?}",
                template.name_template(),
                template.direction(),
                template.presence()
            )
        })
        .collect::<Vec<_>>()
        .join(", ");

    Err(format!(
        "Linux native RTC could not request a WebRTC audio sink pad for caps {}. Available pad templates: {template_names}",
        caps.to_string()
    ))
}

#[cfg(target_os = "linux")]
fn build_linux_voice_peer(app: AppHandle, call_id: &str) -> Result<LinuxRtcPeer, String> {
    Lazy::force(&GST_READY);

    let rtp_caps = build_opus_rtp_caps();
    let rtp_caps_description = rtp_caps.to_string();
    let pipeline = gst::Pipeline::new();

    let audio_bin = gst::parse::bin_from_description(
        "autoaudiosrc name=kodiak-audio-source ! audioconvert ! audioresample ! audio/x-raw,rate=48000,channels=1 ! volume name=kodiak-microphone-volume ! opusenc bitrate=32000 ! rtpopuspay pt=96 ! capsfilter caps=\"application/x-rtp,media=(string)audio,encoding-name=(string)OPUS,payload=(int)96,clock-rate=(int)48000\"",
        true,
    )
    .map_err(gst_error)?;

    let webrtc = gst::ElementFactory::make("webrtcbin")
        .name("kodiak-webrtcbin")
        .property("stun-server", "stun://stun.l.google.com:19302")
        .build()
        .map_err(gst_error)?;

    pipeline.add(&audio_bin).map_err(gst_error)?;
    pipeline.add(&webrtc).map_err(gst_error)?;

    let audio_src_pad = audio_bin
        .static_pad("src")
        .ok_or_else(|| "Linux native RTC audio bin did not expose a source pad.".to_string())?;

    let webrtc_sink_pad = request_webrtc_audio_sink_pad(&webrtc, &rtp_caps)?;

    audio_src_pad
        .link(&webrtc_sink_pad)
        .map_err(|error| format!("Linux native RTC failed to link Opus RTP to webrtcbin for caps {rtp_caps_description}: {error}"))?;

    let app_for_ice = app.clone();
    let call_id_for_ice = call_id.to_string();

    webrtc.connect("on-ice-candidate", false, move |values| {
        let sdp_m_line_index = values
            .get(1)
            .and_then(|value| value.get::<u32>().ok())
            .unwrap_or_default();

        let candidate = values
            .get(2)
            .and_then(|value| value.get::<String>().ok())
            .unwrap_or_default();

        if !candidate.trim().is_empty() {
            let _ = app_for_ice.emit(
                "kodiak-linux-rtc-ice",
                LinuxRtcIceCandidate {
                    call_id: call_id_for_ice.clone(),
                    candidate,
                    sdp_m_line_index,
                },
            );
        }

        None
    });

    let pipeline_weak = pipeline.downgrade();

    webrtc.connect_pad_added(move |_webrtc, src_pad| {
        let Some(pipeline) = pipeline_weak.upgrade() else {
            return;
        };

        let Ok(remote_audio_bin) = gst::parse::bin_from_description(
            "queue ! rtpopusdepay ! opusdec ! audioconvert ! audioresample ! autoaudiosink sync=false",
            true,
        ) else {
            eprintln!("[Kodiak Connect] failed to create Linux native RTC remote audio sink.");
            return;
        };

        if pipeline.add(&remote_audio_bin).is_err() {
            return;
        }

        let _ = remote_audio_bin.sync_state_with_parent();

        let Some(sink_pad) = remote_audio_bin.static_pad("sink") else {
            return;
        };

        let _ = src_pad.link(&sink_pad);
    });

    pipeline.set_state(gst::State::Playing).map_err(gst_error)?;

    Ok(LinuxRtcPeer { pipeline, webrtc })
}

#[cfg(target_os = "linux")]
fn with_peer<T>(call_id: &str, callback: impl FnOnce(&LinuxRtcPeer) -> Result<T, String>) -> Result<T, String> {
    let peers = LINUX_RTC_PEERS.lock().map_err(|_| "Linux RTC peer map lock failed.".to_string())?;
    let peer = peers
        .get(call_id)
        .ok_or_else(|| format!("Linux native RTC peer was not found for call {call_id}."))?;

    callback(peer)
}

#[cfg(target_os = "linux")]
fn create_offer_for_peer(peer: &LinuxRtcPeer) -> Result<String, String> {
    let (sender, receiver) = mpsc::channel();

    let promise = gst::Promise::with_change_func(move |reply| {
        let result = match reply {
            Ok(Some(structure)) => structure
                .value("offer")
                .map_err(gst_error)
                .and_then(|value| {
                    value
                        .get::<gst_webrtc::WebRTCSessionDescription>()
                        .map_err(gst_error)
                }),
            Ok(None) => Err("Linux native RTC offer promise had no reply.".to_string()),
            Err(error) => Err(format!("Linux native RTC promise failed: {error:?}")),
        };

        let _ = sender.send(result);
    });

    peer.webrtc
        .emit_by_name::<()>("create-offer", &[&None::<gst::Structure>, &promise]);

    let offer = wait_for_description(receiver, "offer")?;

    peer.webrtc
        .emit_by_name::<()>("set-local-description", &[&offer, &None::<gst::Promise>]);

    session_description_to_sdp(&offer)
}

#[cfg(target_os = "linux")]
fn create_answer_for_peer(peer: &LinuxRtcPeer, offer_sdp: &str) -> Result<String, String> {
    let offer = parse_sdp(offer_sdp, gst_webrtc::WebRTCSDPType::Offer)?;

    peer.webrtc
        .emit_by_name::<()>("set-remote-description", &[&offer, &None::<gst::Promise>]);

    let (sender, receiver) = mpsc::channel();

    let promise = gst::Promise::with_change_func(move |reply| {
        let result = match reply {
            Ok(Some(structure)) => structure
                .value("answer")
                .map_err(gst_error)
                .and_then(|value| {
                    value
                        .get::<gst_webrtc::WebRTCSessionDescription>()
                        .map_err(gst_error)
                }),
            Ok(None) => Err("Linux native RTC answer promise had no reply.".to_string()),
            Err(error) => Err(format!("Linux native RTC promise failed: {error:?}")),
        };

        let _ = sender.send(result);
    });

    peer.webrtc
        .emit_by_name::<()>("create-answer", &[&None::<gst::Structure>, &promise]);

    let answer = wait_for_description(receiver, "answer")?;

    peer.webrtc
        .emit_by_name::<()>("set-local-description", &[&answer, &None::<gst::Promise>]);

    session_description_to_sdp(&answer)
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn kodiak_linux_rtc_create_offer(app: AppHandle, call_id: String, call_kind: String) -> Result<String, String> {
    if call_kind != "voice" {
        return Err("Linux native video RTC is not enabled yet. Voice is being wired first.".to_string());
    }

    let peer = build_linux_voice_peer(app, &call_id)?;
    let offer_sdp = create_offer_for_peer(&peer)?;

    let mut peers = LINUX_RTC_PEERS.lock().map_err(|_| "Linux RTC peer map lock failed.".to_string())?;
    peers.insert(call_id, peer);

    Ok(offer_sdp)
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn kodiak_linux_rtc_create_answer(app: AppHandle, call_id: String, call_kind: String, offer_sdp: String) -> Result<String, String> {
    if call_kind != "voice" {
        return Err("Linux native video RTC is not enabled yet. Voice is being wired first.".to_string());
    }

    let peer = build_linux_voice_peer(app, &call_id)?;
    let answer_sdp = create_answer_for_peer(&peer, &offer_sdp)?;

    let mut peers = LINUX_RTC_PEERS.lock().map_err(|_| "Linux RTC peer map lock failed.".to_string())?;
    peers.insert(call_id, peer);

    Ok(answer_sdp)
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn kodiak_linux_rtc_apply_answer(call_id: String, answer_sdp: String) -> Result<(), String> {
    with_peer(&call_id, |peer| {
        let answer = parse_sdp(&answer_sdp, gst_webrtc::WebRTCSDPType::Answer)?;

        peer.webrtc
            .emit_by_name::<()>("set-remote-description", &[&answer, &None::<gst::Promise>]);

        Ok(())
    })
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn kodiak_linux_rtc_add_ice_candidate(call_id: String, candidate: LinuxRtcIceCandidateInput) -> Result<(), String> {
    with_peer(&call_id, |peer| {
        let index = candidate.sdp_m_line_index.unwrap_or_default();

        peer.webrtc
            .emit_by_name::<()>("add-ice-candidate", &[&index, &candidate.candidate]);

        Ok(())
    })
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn kodiak_linux_rtc_set_muted(call_id: String, is_muted: bool) -> Result<(), String> {
    with_peer(&call_id, |peer| {
        let microphone_volume = peer
            .pipeline
            .by_name("kodiak-microphone-volume")
            .ok_or_else(|| "Linux native RTC microphone volume control was not found.".to_string())?;

        microphone_volume.set_property("mute", is_muted);

        Ok(())
    })
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn kodiak_linux_rtc_close(call_id: String) -> Result<(), String> {
    let mut peers = LINUX_RTC_PEERS.lock().map_err(|_| "Linux RTC peer map lock failed.".to_string())?;

    if let Some(peer) = peers.remove(&call_id) {
        let _ = peer.pipeline.set_state(gst::State::Null);
    }

    Ok(())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn kodiak_linux_rtc_diagnostics() -> LinuxRtcDiagnostics {
    LinuxRtcDiagnostics {
        available: false,
        reason: Some("Linux native RTC is only available on Linux.".to_string()),
        missing_plugins: vec![],
    }
}
#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn kodiak_linux_rtc_create_offer(_app: AppHandle, _call_id: String, _call_kind: String) -> Result<String, String> {
    Err("Linux native RTC is only available on Linux.".to_string())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn kodiak_linux_rtc_create_answer(_app: AppHandle, _call_id: String, _call_kind: String, _offer_sdp: String) -> Result<String, String> {
    Err("Linux native RTC is only available on Linux.".to_string())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn kodiak_linux_rtc_apply_answer(_call_id: String, _answer_sdp: String) -> Result<(), String> {
    Err("Linux native RTC is only available on Linux.".to_string())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn kodiak_linux_rtc_add_ice_candidate(_call_id: String, _candidate: LinuxRtcIceCandidateInput) -> Result<(), String> {
    Err("Linux native RTC is only available on Linux.".to_string())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn kodiak_linux_rtc_set_muted(_call_id: String, _is_muted: bool) -> Result<(), String> {
    Err("Linux native RTC is only available on Linux.".to_string())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn kodiak_linux_rtc_close(_call_id: String) -> Result<(), String> {
    Err("Linux native RTC is only available on Linux.".to_string())
}

#[cfg(not(target_os = "linux"))]
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct LinuxRtcIceCandidateInput {
    pub candidate: String,
    #[serde(rename = "sdpMLineIndex")]
    pub sdp_m_line_index: Option<u32>,
}

