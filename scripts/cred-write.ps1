# Saves a secret to Windows Credential Manager as a Generic credential, read back by
# scripts/cred-read.ps1 (docs/ops/RELEASE.md §6.6, §6.9). Run it in your own terminal:
#   powershell -NoProfile -File scripts/cred-write.ps1 -Target DeetsMusicAzureSigning -Kind azure
# Why not `cmdkey /pass`: its hidden prompt accepted a paste with extra characters
# (2026-09-15) and gave no way to see it. This one trims, checks the shape, and never echoes.
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [ValidateSet('azure', 'any')][string]$Kind = 'any',
  [string]$User = 'release'
)

$secure = Read-Host -AsSecureString "Paste the secret for '$Target' (nothing is shown), then Enter"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

if (-not $secret) { Write-Error 'empty secret; nothing saved'; exit 2 }
if ($secret -match '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') {
  Write-Error 'that is a Secret ID (a GUID), not the Value; nothing saved'; exit 2
}
if ($secret -match '[\s\x00-\x1f]') { Write-Error 'the paste contains spaces or control characters; nothing saved'; exit 2 }
# Length only: a real Value (2026-09-15) was 40 characters without the often-cited 'Q~' marker.
if ($Kind -eq 'azure' -and -not ($secret.Length -ge 34 -and $secret.Length -le 44)) {
  Write-Error "does not look like an Entra ID client secret Value (about 40 characters, got $($secret.Length)); nothing saved"
  exit 2
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DeetsCredWrite {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredWriteW(ref CREDENTIAL cred, int flags);
  public static bool Write(string target, string user, string secret) {
    var c = new CREDENTIAL();
    c.Type = 1;            // CRED_TYPE_GENERIC
    c.Persist = 2;         // CRED_PERSIST_LOCAL_MACHINE
    c.TargetName = target;
    c.UserName = user;
    c.CredentialBlobSize = secret.Length * 2;
    c.CredentialBlob = Marshal.StringToCoTaskMemUni(secret);
    try { return CredWriteW(ref c, 0); } finally { Marshal.ZeroFreeCoTaskMemUnicode(c.CredentialBlob); }
  }
}
'@

$ok = [DeetsCredWrite]::Write($Target, $User, $secret)
$len = $secret.Length
$secret = $null
if (-not $ok) { Write-Error "CredWriteW failed for '$Target'"; exit 1 }
Write-Output "saved '$Target' ($len characters)"
