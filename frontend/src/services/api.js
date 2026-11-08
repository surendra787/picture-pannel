
const API_BASE_URL = "http://127.0.0.1:8000/api";

// Open an existing vault or create a new one
export async function openVault(password) {
  const response = await fetch(`${API_BASE_URL}/vault/open`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Unable to open vault.");
  }

  return data;
}

// Verify the unlocked vault
export async function verifyVault(token) {
  const response = await fetch(`${API_BASE_URL}/vault/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Vault verification failed.");
  }

  return data;
}

// Close the vault
export async function closeVault(token) {
  const response = await fetch(`${API_BASE_URL}/vault/close`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Unable to close vault.");
  }

  return data;
}

// Upload one photo or video
export async function uploadFile(token, file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || `Unable to upload ${file.name}`);
  }

  return data;
}

// Retrieve all files belonging to this vault
export async function getFiles(token) {
  const response = await fetch(`${API_BASE_URL}/files`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail || "Unable to load files.");
  }

  return data.files;
}

// Retrieve and decrypt a stored media file
export async function getFileBlob(token, fileId) {
  const response = await fetch(
    `${API_BASE_URL}/files/${fileId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    let message = "Unable to open stored file.";

    try {
      const data = await response.json();
      message = data.detail || message;
    } catch {
      // Keep the default error message.
    }

    throw new Error(message);
  }

  return response.blob();
}
