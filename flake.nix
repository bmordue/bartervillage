{
  description = "Barter Village: a shared, turn-based farming and crafting world";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            python3
            sqlite
            git
          ];
          shellHook = ''
            echo "Barter Village dev shell"
            echo "Node $(node --version), npm $(npm --version), SQLite $(sqlite3 --version | cut -d' ' -f1)"
          '';
        };
      });

      packages = forAllSystems (
        pkgs:
        let
          barter-village = pkgs.buildNpmPackage {
            pname = "barter-village";
            version = "0.1.0";
            src = ./.;
            npmDepsHash = "sha256-9RMk3W1WYzhnSda9JAhnj92AIseZta5aRZmCfk/4g+M=";
            dontNpmBuild = true;
            nativeBuildInputs = [ pkgs.makeWrapper ];

            installPhase = ''
              runHook preInstall

              mkdir -p $out/lib/barter-village $out/bin
              cp -r . $out/lib/barter-village

              makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/barter-village-api \
                --add-flags "$out/lib/barter-village/node_modules/tsx/dist/cli.mjs" \
                --add-flags "$out/lib/barter-village/packages/server/src/main.ts"

              makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/barter-village-worker \
                --add-flags "$out/lib/barter-village/node_modules/tsx/dist/cli.mjs" \
                --add-flags "$out/lib/barter-village/packages/worker/src/main.ts"

              runHook postInstall
            '';

            meta = {
              description = "API and tick worker for Barter Village";
              license = pkgs.lib.licenses.mit;
              mainProgram = "barter-village-api";
            };
          };
        in
        {
          default = barter-village;
          inherit barter-village;
        }
      );

      nixosModules.default =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.services.barter-village;
          system = pkgs.stdenv.hostPlatform.system;
        in
        {
          options.services.barter-village = {
            enable = lib.mkEnableOption "Barter Village API and tick worker";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${system}.barter-village;
              description = "Barter Village package providing the API and worker.";
            };

            user = lib.mkOption {
              type = lib.types.str;
              default = "barter-village";
              description = "User that runs the API and worker.";
            };

            group = lib.mkOption {
              type = lib.types.str;
              default = "barter-village";
              description = "Group that runs the API and worker.";
            };

            dataDir = lib.mkOption {
              type = lib.types.str;
              default = "/var/lib/barter-village";
              description = "Directory holding the SQLite database and WAL files.";
            };

            worldId = lib.mkOption {
              type = lib.types.str;
              default = "village";
              description = "World identifier resolved by the worker.";
            };

            host = lib.mkOption {
              type = lib.types.str;
              default = "127.0.0.1";
              description = "Address the API listens on.";
            };

            port = lib.mkOption {
              type = lib.types.port;
              default = 3000;
              description = "Port the API listens on.";
            };

            rpID = lib.mkOption {
              type = lib.types.str;
              default = "localhost";
              description = "Stable WebAuthn relying-party ID (the site's domain).";
            };

            origin = lib.mkOption {
              type = lib.types.str;
              default = "http://localhost:3000";
              description = "Public HTTPS origin clients use for WebAuthn.";
            };

            environmentFile = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              description = ''
                Optional systemd environment file for deployment secrets:
                BARTER_CREDENTIAL_KEY, the Discord and GitHub client secrets,
                VAPID_PRIVATE_KEY and the S3-compatible backup credentials.
                Keep it out of the Nix store.
              '';
            };

            worker.pollIntervalMs = lib.mkOption {
              type = lib.types.positiveInt;
              default = 5000;
              description = "How often the tick worker polls for a due tick.";
            };
          };

          config = lib.mkIf cfg.enable {
            users.groups.${cfg.group} = { };
            users.users.${cfg.user} = {
              isSystemUser = true;
              group = cfg.group;
              home = cfg.dataDir;
              createHome = true;
            };

            systemd.services.barter-village-api = {
              description = "Barter Village API";
              after = [ "network.target" ];
              wantedBy = [ "multi-user.target" ];
              environment = {
                DATABASE_PATH = "${cfg.dataDir}/barter-village.sqlite";
                WORLD_ID = cfg.worldId;
                HOST = cfg.host;
                PORT = toString cfg.port;
                BARTER_RP_ID = cfg.rpID;
                BARTER_ORIGIN = cfg.origin;
                NODE_ENV = "production";
              };
              serviceConfig = {
                ExecStart = "${cfg.package}/bin/barter-village-api";
                User = cfg.user;
                Group = cfg.group;
                WorkingDirectory = cfg.dataDir;
                StateDirectory = lib.baseNameOf cfg.dataDir;
                EnvironmentFile = lib.optional (cfg.environmentFile != null) cfg.environmentFile;
                Restart = "on-failure";
                RestartSec = 5;
              };
            };

            systemd.services.barter-village-worker = {
              description = "Barter Village tick worker";
              after = [ "network.target" ];
              wantedBy = [ "multi-user.target" ];
              environment = {
                DATABASE_PATH = "${cfg.dataDir}/barter-village.sqlite";
                WORLD_ID = cfg.worldId;
                POLL_INTERVAL_MS = toString cfg.worker.pollIntervalMs;
                NODE_ENV = "production";
              };
              serviceConfig = {
                ExecStart = "${cfg.package}/bin/barter-village-worker";
                User = cfg.user;
                Group = cfg.group;
                WorkingDirectory = cfg.dataDir;
                StateDirectory = lib.baseNameOf cfg.dataDir;
                EnvironmentFile = lib.optional (cfg.environmentFile != null) cfg.environmentFile;
                Restart = "on-failure";
                RestartSec = 5;
              };
            };
          };
        };

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
