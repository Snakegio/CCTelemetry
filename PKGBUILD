# Maintainer: Giorgio Privitera <giorgio.privitera@relatech.com>
pkgname=cctelemetry-bin
pkgver=0.1.5
pkgrel=1
pkgdesc="Menu bar app for Claude Code token telemetry"
arch=('x86_64')
url="https://github.com/Snakegio/CCTelemetry"
license=('MIT')
depends=('webkit2gtk-4.1' 'gtk3' 'libayatana-appindicator' 'librsvg')
optdepends=('python: session-limit indicator (cclimits)')
provides=('cctelemetry')
conflicts=('cctelemetry')
source=("https://github.com/Snakegio/CCTelemetry/releases/download/v${pkgver}/cctelemetry_${pkgver}_amd64.deb")
sha256sums=('SKIP')

package() {
  tar -xf data.tar.gz -C "$pkgdir"
}
