use std::collections::HashMap;

use actix::prelude::{Actor, Context, Handler, Recipient};
use uuid::Uuid;

use crate::messages::{Connect, Disconnect, WsMessage};

type Socket = Recipient<WsMessage>;

// The lobby keeps track of a common/shared state between all clients.
pub struct Lobby {
    // Maps client IDs to a Socket.
    sessions: HashMap<Uuid, Socket>,
}

impl Default for Lobby {
    fn default() -> Self {
        Lobby {
            sessions: HashMap::new(),
        }
    }
}

impl Lobby {
    // Sends a message to a specific client.
    fn send_message(&self, message: &str, id_to: &Uuid) {
        if let Some(socket_recipient) = self.sessions.get(id_to) {
            let _ = socket_recipient.do_send(WsMessage(message.to_owned()));
        } else {
            println!("Attempting to send message but couldn't find client id.");
        }
    }

    // Sends a message to every connected client stored in self.sessions.
    fn send_to_everyone(&self, message: &str) {
        self.sessions
            .keys()
            .for_each(|client_id| self.send_message(message, client_id));
    }

    // Sends a message to every connected client stored in self.sessions.
    fn send_to_everyone_except_self(&self, message: &str, self_id: &Uuid) {
        self.sessions
            .keys()
            .filter(|client_id| *client_id.to_owned() != *self_id)
            .for_each(|client_id| self.send_message(message, client_id));
    }
}

impl Actor for Lobby {
    type Context = Context<Self>;
}

impl Handler<Connect> for Lobby {
    type Result = ();

    fn handle(&mut self, msg: Connect, _: &mut Context<Self>) {
        // Store the address of the client in the sessions hashmap.
        self.sessions.insert(msg.self_id, msg.addr);

        // TODO: Remove this println. Only here to show that events occur.
        println!("Client with id '{}' connected.", msg.self_id);
    }
}

impl Handler<Disconnect> for Lobby {
    type Result = ();

    fn handle(&mut self, msg: Disconnect, _: &mut Context<Self>) {
        // Try and remove the client from the sessions hashmap.
        if self.sessions.remove(&msg.self_id).is_some() {
            // TODO: Remove this println. Only here to show that events occur.
            println!("Client with id '{}' disconnected.", msg.self_id);
        }
    }
}
