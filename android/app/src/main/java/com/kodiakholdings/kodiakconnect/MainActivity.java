package com.kodiakholdings.kodiakconnect;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int KODIAK_MEDIA_PERMISSION_REQUEST = 7612;
    private PermissionRequest pendingKodiakPermissionRequest;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestKodiakRuntimeMediaPermissions();

        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handleKodiakWebPermissionRequest(request));
            }
        });
    }

    private void handleKodiakWebPermissionRequest(PermissionRequest request) {
        List<String> missingPermissions = getMissingAndroidPermissionsForWebRequest(request);

        if (missingPermissions.isEmpty()) {
            grantAllowedWebResources(request);
            return;
        }

        pendingKodiakPermissionRequest = request;
        ActivityCompat.requestPermissions(
            this,
            missingPermissions.toArray(new String[0]),
            KODIAK_MEDIA_PERMISSION_REQUEST
        );
    }

    private void requestKodiakRuntimeMediaPermissions() {
        List<String> missingPermissions = new ArrayList<>();

        if (!hasAndroidPermission(Manifest.permission.RECORD_AUDIO)) {
            missingPermissions.add(Manifest.permission.RECORD_AUDIO);
        }

        if (!hasAndroidPermission(Manifest.permission.CAMERA)) {
            missingPermissions.add(Manifest.permission.CAMERA);
        }

        if (!missingPermissions.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                missingPermissions.toArray(new String[0]),
                KODIAK_MEDIA_PERMISSION_REQUEST
            );
        }
    }

    private List<String> getMissingAndroidPermissionsForWebRequest(PermissionRequest request) {
        List<String> missingPermissions = new ArrayList<>();

        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                && !hasAndroidPermission(Manifest.permission.RECORD_AUDIO)
                && !missingPermissions.contains(Manifest.permission.RECORD_AUDIO)) {
                missingPermissions.add(Manifest.permission.RECORD_AUDIO);
            }

            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                && !hasAndroidPermission(Manifest.permission.CAMERA)
                && !missingPermissions.contains(Manifest.permission.CAMERA)) {
                missingPermissions.add(Manifest.permission.CAMERA);
            }
        }

        return missingPermissions;
    }

    private boolean hasAndroidPermission(String permission) {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void grantAllowedWebResources(PermissionRequest request) {
        List<String> allowedResources = new ArrayList<>();

        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                && hasAndroidPermission(Manifest.permission.RECORD_AUDIO)) {
                allowedResources.add(resource);
            }

            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                && hasAndroidPermission(Manifest.permission.CAMERA)) {
                allowedResources.add(resource);
            }
        }

        if (allowedResources.isEmpty()) {
            request.deny();
            return;
        }

        request.grant(allowedResources.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode != KODIAK_MEDIA_PERMISSION_REQUEST || pendingKodiakPermissionRequest == null) {
            return;
        }

        PermissionRequest request = pendingKodiakPermissionRequest;
        pendingKodiakPermissionRequest = null;

        if (getMissingAndroidPermissionsForWebRequest(request).isEmpty()) {
            grantAllowedWebResources(request);
        } else {
            request.deny();
        }
    }
}