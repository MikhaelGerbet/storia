# Lance le gardien de la carte graphique à chaque ouverture de session Windows, sans fenêtre,
# et pose sur le bureau les raccourcis « Mode jeu », « Reprendre » et la page du gardien.
#
#   powershell -ExecutionPolicy Bypass -File gardien\windows\installer.ps1            le gardien
#   powershell -ExecutionPolicy Bypass -File gardien\windows\installer.ps1 -Studio    le gardien et le studio Storia
#   powershell -ExecutionPolicy Bypass -File gardien\windows\installer.ps1 -Studio -Reseau   et l'application ouverte aux tablettes du Wi-Fi
#   powershell -ExecutionPolicy Bypass -File gardien\windows\installer.ps1 -Retirer   tout enlever
param([switch]$Studio, [switch]$Reseau, [switch]$Retirer)
$ErrorActionPreference = 'Stop'

$gardien = Split-Path -Parent $PSScriptRoot
$racine = Split-Path -Parent $gardien
$bureau = [Environment]::GetFolderPath('Desktop')
$raccourcis = @('Mode jeu.lnk', 'Reprendre.lnk', 'Gardien de la carte graphique.url')

if ($Retirer) {
  foreach ($nom in 'Storia - gardien', 'Storia - studio') {
    if (Get-ScheduledTask -TaskName $nom -ErrorAction SilentlyContinue) {
      Stop-ScheduledTask -TaskName $nom -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $nom -Confirm:$false
      Write-Host "Retiré : $nom"
    }
  }
  foreach ($r in $raccourcis) { Remove-Item -LiteralPath (Join-Path $bureau $r) -ErrorAction SilentlyContinue }
  return
}

$node = (Get-Command node -ErrorAction Stop).Source

function Programmer([string]$nom, [string]$dossier, [string]$arguments) {
  $journaux = Join-Path $dossier 'journaux'
  New-Item -ItemType Directory -Force -Path $journaux | Out-Null
  $sortie = Join-Path $journaux 'console.log'
  # PowerShell caché lance Node et garde tout ce qu'il affiche dans journaux\console.log.
  $commande = "Set-Location -LiteralPath '$dossier'; & '$node' $arguments *>> '$sortie'"
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$commande`""
  $declencheur = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $reglages = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $nom -Action $action -Trigger $declencheur -Settings $reglages -Description 'Storia : lancé à l''ouverture de session.' -Force | Out-Null
  Start-ScheduledTask -TaskName $nom
  Write-Host "Installé et lancé : $nom (journal : $sortie)"
}

Programmer 'Storia - gardien' $gardien 'src/principal.ts'
if ($Studio) {
  $ouvert = if ($Reseau) { ' --reseau' } else { '' }
  Programmer 'Storia - studio' (Join-Path $racine 'serveur') "--disable-warning=ExperimentalWarning src/principal.ts$ouvert"
  if ($Reseau) { Write-Host "Adresse à taper sur la tablette : au début de $(Join-Path $racine 'serveur\journaux\console.log')" }
}

$shell = New-Object -ComObject WScript.Shell
foreach ($nom in 'Mode jeu', 'Reprendre') {
  $lien = $shell.CreateShortcut((Join-Path $bureau "$nom.lnk"))
  $lien.TargetPath = Join-Path $PSScriptRoot "$nom.cmd"
  $lien.WorkingDirectory = $PSScriptRoot
  $lien.WindowStyle = 7
  $lien.Save()
}
Set-Content -LiteralPath (Join-Path $bureau 'Gardien de la carte graphique.url') -Value "[InternetShortcut]`r`nURL=http://localhost:7870/" -Encoding ASCII
Write-Host 'Raccourcis posés sur le bureau : Mode jeu, Reprendre, Gardien de la carte graphique.'
Write-Host 'Page du gardien : http://localhost:7870'
