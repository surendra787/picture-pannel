import { useEffect, useRef, useState } from "react";

import {
  LockKeyhole,
  Eye,
  EyeOff,
  ShieldCheck,
  ArrowRight,
  Image,
  Video,
  Lock,
  FolderLock,
  LogOut,
  CheckCircle,
  LoaderCircle,
  X,
  Play,
  FileImage,
  Plus,
  RefreshCw,
} from "lucide-react";

import {
  openVault,
  closeVault,
  uploadFile,
  getFiles,
  getFileBlob,
} from "./services/api";

import "./App.css";

function App() {
  // ------------------------------
  // STATE
  // ------------------------------

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [vault, setVault] = useState(null);

  const [files, setFiles] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [previews, setPreviews] = useState({});

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const [mediaUrls, setMediaUrls] = useState({});
  const [selectedMedia, setSelectedMedia] = useState(null);

  // ------------------------------
  // REFS
  // ------------------------------

  const photoInput = useRef(null);
  const videoInput = useRef(null);

  // Keep track of generated object URLs.
  // These refs prevent URLs from being revoked too early.
  const previewUrlsRef = useRef({});
  const mediaUrlsRef = useRef({});

  const token = vault?.token;

  // ------------------------------
  // OBJECT URL CLEANUP
  // ------------------------------

  const clearAllMediaUrls = () => {
    Object.values(previewUrlsRef.current).forEach((url) => {
      URL.revokeObjectURL(url);
    });

    Object.values(mediaUrlsRef.current).forEach((url) => {
      URL.revokeObjectURL(url);
    });

    previewUrlsRef.current = {};
    mediaUrlsRef.current = {};

    setPreviews({});
    setMediaUrls({});
    setSelectedMedia(null);
  };

  // Release all generated URLs when the component unmounts.
  useEffect(() => {
    return () => {
      Object.values(previewUrlsRef.current).forEach((url) => {
        URL.revokeObjectURL(url);
      });

      Object.values(mediaUrlsRef.current).forEach((url) => {
        URL.revokeObjectURL(url);
      });

      previewUrlsRef.current = {};
      mediaUrlsRef.current = {};
    };
  }, []);

  // ------------------------------
  // NORMALIZE BACKEND FILE DATA
  // ------------------------------

  const normalizeFiles = (response) => {
    const fileList = Array.isArray(response)
      ? response
      : response?.files || [];

    return fileList.map((file) => {
      const rawType = file.type || file.file_type || file.mime_type || "";

      const isImage =
        rawType === "image" || String(rawType).startsWith("image/");

      return {
        ...file,
        id: file.id,
        name: file.name || file.original_name || "Unnamed file",
        type: isImage ? "image" : "video",
      };
    });
  };

  // ------------------------------
  // OPEN OR CREATE VAULT
  // ------------------------------

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!password.length) {
      setError("Please enter your password.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const data = await openVault(password);

      if (!data?.access_token || !data?.vault_id) {
        throw new Error("Invalid response received from the server.");
      }

      sessionStorage.setItem(
        "codedpad_access_token",
        data.access_token
      );

      setVault({
        id: data.vault_id,
        status: data.status,
        token: data.access_token,
      });

      setPassword("");
      setError("");
      setMessage("");
    } catch (err) {
      setError(err.message || "Unable to open vault.");
    } finally {
      setLoading(false);
    }
  };

  // ------------------------------
  // LOAD SAVED FILES
  // ------------------------------

  const loadStoredFiles = async (accessToken) => {
    if (!accessToken) {
      throw new Error("Vault session is missing. Unlock again.");
    }

    const data = await getFiles(accessToken);
    const normalizedFiles = normalizeFiles(data);

    setFiles(normalizedFiles);

    return normalizedFiles;
  };

  // Load gallery whenever a vault is opened.
  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    const loadGallery = async () => {
      try {
        const data = await getFiles(token);

        if (!cancelled) {
          setFiles(normalizeFiles(data));
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Unable to load saved media.");
        }
      }
    };

    loadGallery();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // ------------------------------
  // SELECT PHOTOS OR VIDEOS
  // ------------------------------

  const handleFileSelection = (event, type) => {
    const selected = Array.from(event.target.files || []);

    if (selected.length === 0) {
      return;
    }

    const allowed = selected.filter((file) => {
      if (type === "image") {
        return file.type.startsWith("image/");
      }

      return file.type.startsWith("video/");
    });

    if (allowed.length !== selected.length) {
      setError("Some selected files have an unsupported type.");
    } else {
      setError("");
    }

    setMessage("");

    const newItems = allowed.map((file) => ({
      id: crypto.randomUUID(),
      file,
      type,
    }));

    // Generate preview URLs and keep references to them.
    newItems.forEach((item) => {
      previewUrlsRef.current[item.id] = URL.createObjectURL(item.file);
    });

    setPendingFiles((previous) => [
      ...previous,
      ...newItems,
    ]);

    setPreviews((previous) => {
      const next = { ...previous };

      newItems.forEach((item) => {
        next[item.id] = previewUrlsRef.current[item.id];
      });

      return next;
    });

    // Allow selecting the same file again later.
    event.target.value = "";
  };

  // ------------------------------
  // REMOVE PENDING FILE
  // ------------------------------

  const removePendingFile = (id) => {
    const previewUrl = previewUrlsRef.current[id];

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      delete previewUrlsRef.current[id];
    }

    setPendingFiles((previous) =>
      previous.filter((item) => item.id !== id)
    );

    setPreviews((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });

    setError("");
  };

  // ------------------------------
  // SAVE / UPLOAD PENDING FILES
  // ------------------------------

  const savePendingFiles = async () => {
    if (!token) {
      throw new Error("Vault session is missing. Unlock again.");
    }

    // Use a snapshot so the upload loop works with a stable list.
    const filesToUpload = [...pendingFiles];

    if (filesToUpload.length === 0) {
      return true;
    }

    setUploading(true);
    setProgress(0);
    setError("");
    setMessage("");

    const successfullyUploaded = [];

    try {
      for (let index = 0; index < filesToUpload.length; index++) {
        const item = filesToUpload[index];

        await uploadFile(token, item.file);

        successfullyUploaded.push(item.id);

        const percentage = Math.round(
          ((index + 1) / filesToUpload.length) * 100
        );

        setProgress(percentage);
      }

      // Remove successfully uploaded items from the pending list.
      const completed = new Set(successfullyUploaded);

      setPendingFiles((previous) =>
        previous.filter((item) => !completed.has(item.id))
      );

      // Revoke preview URLs for successfully uploaded files only.
      completed.forEach((id) => {
        const url = previewUrlsRef.current[id];

        if (url) {
          URL.revokeObjectURL(url);
          delete previewUrlsRef.current[id];
        }
      });

      setPreviews((previous) => {
        const next = { ...previous };

        completed.forEach((id) => {
          delete next[id];
        });

        return next;
      });

      // Refresh the saved gallery.
      await loadStoredFiles(token);

      return true;
    } catch (err) {
      // Files uploaded before the error remain saved.
      // Files not uploaded remain in the pending list.
      try {
        await loadStoredFiles(token);
      } catch {
        // Keep the original upload error.
      }

      throw err;
    } finally {
      setUploading(false);
    }
  };

  // ------------------------------
  // SAVE BUTTON
  // ------------------------------

  const handleSave = async () => {
    if (uploading) return;

    if (pendingFiles.length === 0) {
      setMessage("All your files are already saved.");
      setError("");
      return;
    }

    try {
      setError("");
      setMessage("");

      await savePendingFiles();

      setMessage("Your files have been saved successfully!");
    } catch (err) {
      setError(err.message || "Unable to save files.");
    }
  };

  // ------------------------------
  // SAVE AND CLOSE VAULT
  // ------------------------------

  const handleSaveAndClose = async () => {
    if (uploading) return;

    if (!token) {
      setError("Vault session is missing. Please unlock again.");
      return;
    }

    try {
      setError("");
      setMessage("");

      // Save all pending files before closing.
      // If an upload fails, this throws and the vault stays open.
      if (pendingFiles.length > 0) {
        await savePendingFiles();
      }

      await closeVault(token);

      sessionStorage.removeItem("codedpad_access_token");

      clearAllMediaUrls();

      setVault(null);
      setFiles([]);
      setPendingFiles([]);
      setProgress(0);
      setMessage("");
      setError("");
    } catch (err) {
      setError(err.message || "Unable to save and close vault.");
    }
  };

  // ------------------------------
  // CLOSE VAULT WITHOUT PENDING FILES
  // ------------------------------

  const handleCloseVault = async () => {
    if (uploading) return;

    if (pendingFiles.length > 0) {
      setError("Please save your pending files before closing.");
      return;
    }

    await handleSaveAndClose();
  };

  // ------------------------------
  // OPEN SAVED PHOTO OR VIDEO
  // ------------------------------

  const openStoredMedia = async (file) => {
    if (!token) {
      setError("Vault session is missing. Unlock again.");
      return;
    }

    try {
      setError("");

      const blob = await getFileBlob(token, file.id);
      const url = URL.createObjectURL(blob);

      // Revoke an older URL for this same file, if present.
      const oldUrl = mediaUrlsRef.current[file.id];

      if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
      }

      mediaUrlsRef.current[file.id] = url;

      setMediaUrls((previous) => ({
        ...previous,
        [file.id]: url,
      }));

      setSelectedMedia({
        ...file,
        url,
      });
    } catch (err) {
      setError(err.message || "Unable to open this media file.");
    }
  };

  // ------------------------------
  // CLOSE MEDIA PREVIEW
  // ------------------------------

  const closeMediaPreview = () => {
    setSelectedMedia(null);
  };

  // ------------------------------
  // PASSWORD SCREEN
  // ------------------------------

  if (!vault) {
    return (
      <div className="app-container">
        <nav className="navbar">
          <div className="brand">
            <div className="brand-icon">
              <LockKeyhole size={23} />
            </div>

            <span>
              Coded<span className="brand-highlight">Pad</span>
            </span>
          </div>

          <div className="nav-security">
            <ShieldCheck size={17} />
            <span>Private Storage</span>
          </div>
        </nav>

        <main className="main-content">
          <div className="login-card">
            <div className="lock-circle">
              <LockKeyhole size={34} />
            </div>

            <div className="welcome-text">
              <span className="small-label">
                YOUR PERSONAL SPACE
              </span>

              <h1>Welcome to CodedPad</h1>

              <p>
                Your memories deserve a private space.
                Enter your password to open your vault
                or create a new one.
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <label htmlFor="password">Your Password</label>

              <div className="password-wrapper">
                <Lock size={19} className="input-lock" />

                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                  autoComplete="off"
                />

                <button
                  type="button"
                  className="eye-button"
                  onClick={() => setShowPassword((previous) => !previous)}
                  aria-label={
                    showPassword ? "Hide password" : "Show password"
                  }
                >
                  {showPassword ? (
                    <EyeOff size={19} />
                  ) : (
                    <Eye size={19} />
                  )}
                </button>
              </div>

              <button
                type="submit"
                className="open-button"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <LoaderCircle className="spin-icon" />
                    Opening Vault...
                  </>
                ) : (
                  <>
                    Open / Create Vault
                    <ArrowRight size={19} />
                  </>
                )}
              </button>

              {error && (
                <div className="error-message">{error}</div>
              )}
            </form>

            <div className="divider">
              <span>YOUR FILES, YOUR SPACE</span>
            </div>

            <div className="features">
              <div className="feature-item">
                <Image size={20} />
                <span>Private Photos</span>
              </div>

              <div className="feature-item">
                <Video size={20} />
                <span>Private Videos</span>
              </div>
            </div>
          </div>

          <div className="bottom-text">
            <ShieldCheck size={15} />
            Your private space is accessible using your password.
          </div>
        </main>

        <footer className="footer">
          © 2026 CodedPad. Your memories, your privacy.
        </footer>
      </div>
    );
  }

  // ------------------------------
  // PRIVATE STORAGE PAGE
  // ------------------------------

  return (
    <div className="app-container">
      <nav className="navbar">
        <div className="brand">
          <div className="brand-icon">
            <LockKeyhole size={23} />
          </div>

          <span>
            Coded<span className="brand-highlight">Pad</span>
          </span>
        </div>

        <div className="storage-nav-actions">
          <div className="vault-status">
            <ShieldCheck size={17} />
            Vault Unlocked
          </div>

          <button
            className="close-vault-button"
            onClick={handleCloseVault}
            disabled={uploading}
          >
            <LogOut size={17} />
            Close Vault
          </button>
        </div>
      </nav>

      <main className="storage-main">
        {/* VAULT HEADING */}

        <div className="storage-heading">
          <div>
            <span className="small-label">
              YOUR PERSONAL SPACE
            </span>

            <h1>My Private Vault</h1>

            <p>
              Store your photos and videos in one private place.
            </p>
          </div>

          <div className="vault-id-label">
            <FolderLock size={18} />
            Vault #{vault.id}
          </div>
        </div>

        {/* ERROR MESSAGE */}

        {error && (
          <div className="error-message storage-alert">
            {error}
          </div>
        )}

        {/* SUCCESS MESSAGE */}

        {message && (
          <div className="success-message storage-alert">
            <CheckCircle size={17} />
            {message}
          </div>
        )}

        {/* UPLOAD SECTION */}

        <section className="upload-section">
          <div className="upload-section-heading">
            <div>
              <h2>Add New Media</h2>
              <p>Select photos or videos to add to your vault.</p>
            </div>

            <div className="upload-count">
              {pendingFiles.length} pending
            </div>
          </div>

          <div className="upload-buttons">
            {/* PHOTO UPLOAD */}

            <button
              className="upload-option"
              onClick={() => photoInput.current?.click()}
              disabled={uploading}
            >
              <div className="upload-option-icon">
                <Image size={25} />
              </div>

              <div>
                <strong>Upload Photos</strong>
                <span>JPG, PNG, WEBP, GIF</span>
              </div>

              <Plus size={20} />
            </button>

            {/* VIDEO UPLOAD */}

            <button
              className="upload-option"
              onClick={() => videoInput.current?.click()}
              disabled={uploading}
            >
              <div className="upload-option-icon">
                <Video size={25} />
              </div>

              <div>
                <strong>Upload Videos</strong>
                <span>MP4, WEBM, MOV</span>
              </div>

              <Plus size={20} />
            </button>
          </div>

          {/* HIDDEN PHOTO INPUT */}

          <input
            ref={photoInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => handleFileSelection(e, "image")}
          />

          {/* HIDDEN VIDEO INPUT */}

          <input
            ref={videoInput}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            multiple
            hidden
            onChange={(e) => handleFileSelection(e, "video")}
          />
        </section>

        {/* SELECTED / PENDING FILES */}

        {pendingFiles.length > 0 && (
          <section className="pending-section">
            <div className="gallery-heading">
              <h2>Selected Files</h2>
              <span>Not saved yet</span>
            </div>

            <div className="media-grid">
              {pendingFiles.map((item) => (
                <div
                  className="media-card pending-card"
                  key={item.id}
                >
                  <div className="media-preview">
                    {item.type === "image" ? (
                      <img
                        src={previews[item.id]}
                        alt={item.file.name}
                      />
                    ) : (
                      <video
                        src={previews[item.id]}
                        controls
                      />
                    )}

                    <span className="pending-label">
                      Pending
                    </span>
                  </div>

                  <div className="media-card-details">
                    <span className="media-name">
                      {item.file.name}
                    </span>

                    <button
                      className="remove-file-button"
                      onClick={() => removePendingFile(item.id)}
                      disabled={uploading}
                      title="Remove selected file"
                      aria-label={`Remove ${item.file.name}`}
                    >
                      <X size={17} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* UPLOAD PROGRESS */}

        {uploading && (
          <div className="upload-progress">
            <div className="progress-text">
              <span>Uploading and encrypting files...</span>
              <strong>{progress}%</strong>
            </div>

            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* SAVED MEDIA GALLERY */}

        <section className="gallery-section">
          <div className="gallery-heading">
            <div>
              <h2>Saved Media</h2>
              <p>Your previously stored photos and videos.</p>
            </div>

            <button
              className="refresh-button"
              onClick={() =>
                loadStoredFiles(token).catch((err) =>
                  setError(err.message || "Unable to refresh gallery.")
                )
              }
              disabled={uploading}
              title="Refresh gallery"
            >
              <RefreshCw size={17} />
              Refresh
            </button>
          </div>

          {files.length === 0 ? (
            <div className="empty-gallery">
              <div className="empty-gallery-icon">
                <FileImage size={35} />
              </div>

              <h3>No saved media yet</h3>

              <p>
                Upload your first photos or videos to start
                building your private collection.
              </p>
            </div>
          ) : (
            <div className="media-grid">
              {files.map((file) => (
                <button
                  className="media-card saved-card"
                  key={file.id}
                  onClick={() => openStoredMedia(file)}
                  type="button"
                >
                  <div className="media-preview">
                    {file.type === "image" ? (
                      mediaUrls[file.id] ? (
                        <img
                          src={mediaUrls[file.id]}
                          alt={file.name}
                        />
                      ) : (
                        <div className="media-loading">
                          <Image size={30} />
                          <span>Click to view</span>
                        </div>
                      )
                    ) : (
                      <div className="media-loading">
                        <Play size={32} />
                        <span>Play video</span>
                      </div>
                    )}

                    <span className="saved-label">
                      Saved
                    </span>
                  </div>

                  <div className="media-card-details">
                    <span className="media-name">
                      {file.name}
                    </span>

                    <span className="media-file-type">
                      {file.type}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* SAVE ACTIONS */}

        <section className="save-actions">
          <div>
            <h3>Save Your Changes</h3>

            <p>
              {pendingFiles.length > 0
                ? `${pendingFiles.length} file(s) waiting to be saved.`
                : "Your saved files are safely stored."}
            </p>
          </div>

          <div className="save-buttons">
            <button
              className="save-button"
              onClick={handleSave}
              disabled={uploading}
            >
              {uploading ? (
                <LoaderCircle className="spin-icon" />
              ) : (
                <CheckCircle size={18} />
              )}

              Save
            </button>

            <button
              className="save-close-button"
              onClick={handleSaveAndClose}
              disabled={uploading}
            >
              <Lock size={17} />
              Save & Close
            </button>
          </div>
        </section>
      </main>

      {/* FOOTER */}

      <footer className="footer">
        © 2026 CodedPad. Your memories, your privacy.
      </footer>

      {/* MEDIA PREVIEW MODAL */}

      {selectedMedia && (
        <div
          className="media-modal"
          onClick={closeMediaPreview}
        >
          <div
            className="media-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <strong>{selectedMedia.name}</strong>

              <button
                onClick={closeMediaPreview}
                aria-label="Close preview"
                type="button"
              >
                <X size={22} />
              </button>
            </div>

            {selectedMedia.type === "image" ? (
              <img
                src={selectedMedia.url}
                alt={selectedMedia.name}
              />
            ) : (
              <video
                src={selectedMedia.url}
                controls
                autoPlay
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;