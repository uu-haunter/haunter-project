mod client;
mod config;
mod database;
mod endpoints;
mod gtfs;
mod lobby;
mod util;
mod messages;
mod protocol;
mod ws;

use actix::Actor;
use actix_web::{App, HttpServer};

use crate::config::{Config, CONFIG_FILE_PATH};
use crate::database::init_connection;
use crate::database::Connection;
use crate::endpoints::ws_endpoint as ws_endpoint_route;
use crate::lobby::Lobby;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let mut config_handler = Config::new();

    // If the load somehow fails the program will panic since it cannot operate
    // without the necessary data.
    if let Err(reason) = config_handler.load_config(CONFIG_FILE_PATH) {
        panic!("{}", reason);
    };

    // Get Database URI from config
    let db_uri = config_handler.get_database_value("uri").unwrap();
    let conn = init_connection(db_uri);

    // Create the common/shared state.
    let lobby = Lobby::new().start();

    HttpServer::new(move || App::new().service(ws_endpoint_route).data(lobby.clone()))
        // The "0.0.0.0" means that the server accepts requests from any host (127.0.0.1, 192.168.x.x, etc..)
        .bind("0.0.0.0:8080")?
        // By default, `run()` starts the server with the same amount of threads as logical CPU cores on the host
        // machine. This can be configured with the method `workers()`, which sets the starting number of threads
        // when the server is started.
        .run()
        .await
}
