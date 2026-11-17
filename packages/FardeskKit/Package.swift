// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "FardeskKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "FardeskModels", targets: ["FardeskModels"]),
        .library(name: "FardeskClient", targets: ["FardeskClient"]),
        .library(name: "FardeskStore", targets: ["FardeskStore"]),
        .library(name: "FardeskCLICore", targets: ["FardeskCLICore"]),
        .executable(name: "fardesk", targets: ["fardesk"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-argument-parser", from: "1.5.0"),
    ],
    targets: [
        .target(name: "FardeskModels"),
        .target(name: "FardeskClient", dependencies: ["FardeskModels"]),
        .target(name: "FardeskStore", dependencies: ["FardeskModels", "FardeskClient"]),
        .target(
            name: "FardeskCLICore",
            dependencies: [
                "FardeskStore", "FardeskModels", "FardeskClient",
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ]
        ),
        .executableTarget(name: "fardesk", dependencies: ["FardeskCLICore"]),
        .target(
            name: "FardeskFixtures",
            dependencies: ["FardeskModels", "FardeskStore", "FardeskClient", "FardeskTestDaemon"],
            path: "Tests/FardeskFixtures"
        ),
        .target(name: "FardeskTestDaemon", path: "Tests/FardeskTestDaemon"),
        .testTarget(name: "FardeskModelsTests", dependencies: ["FardeskModels"]),
        .testTarget(
            name: "FardeskClientTests",
            dependencies: ["FardeskClient", "FardeskModels", "FardeskFixtures", "FardeskTestDaemon"]
        ),
        .testTarget(
            name: "FardeskStoreTests",
            dependencies: [
                "FardeskStore", "FardeskModels", "FardeskClient", "FardeskFixtures", "FardeskTestDaemon",
            ]
        ),
        .testTarget(
            name: "FardeskCLICoreTests",
            dependencies: [
                "FardeskCLICore", "FardeskStore", "FardeskModels", "FardeskClient", "FardeskFixtures",
                "FardeskTestDaemon",
            ]
        ),
    ],
    swiftLanguageModes: [.v6]
)
