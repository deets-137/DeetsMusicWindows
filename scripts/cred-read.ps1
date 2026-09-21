# Writes one Generic credential's password from Windows Credential Manager to stdout, for
# scripts/release.mjs (docs/ops/RELEASE.md §6.6). Never run it where stdout is shown or logged.
#   powershell -NoProfile -File scripts/cred-read.ps1 -Target DeetsMusicUpdaterKey
param([Parameter(Mandatory = $true)][string]$Target)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DeetsCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) return null; // 1 = CRED_TYPE_GENERIC
    try {
      var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
    } finally { CredFree(p); }
  }
}
'@

$secret = [DeetsCred]::Read($Target)
if (-not $secret) {
  [Console]::Error.WriteLine("no Generic credential '$Target' in Credential Manager")
  exit 2
}
[Console]::Out.Write($secret)
